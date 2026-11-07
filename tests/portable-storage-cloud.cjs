/* Opt-in real HTTP test. Run only with the CLI already on studio-portable-apps:
 * $env:PORTABLE_STORAGE_CLOUD='1'; $env:PORTABLE_PG_DRIVER='<psycopg directory>';
 * node tests\portable-storage-cloud.cjs
 * Requires installed @insforge/sdk and Python psycopg. Never switches branches.
 * Fixtures are schema-only-branch data, not migrations. Finally revokes their
 * passwords/verification and disables non-admins (admin integrity is preserved).
 * Immutable history and physical objects require the
 * branch owner to DESTROY this disposable branch after merging schema only.
 */
'use strict';
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { File } = require('node:buffer');
let createClient;

const baseUrl = 'https://vxpd968k-eaa.eu-central.insforge.app';
const clients = [];
let stage = 'branch guard';
let fixture;
function cli(command) {
  return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npx -y @insforge/cli@latest ${command}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const python = String.raw`
import json, os, sys
if os.environ.get('PORTABLE_PG_DRIVER'):
    sys.path.insert(0, os.environ['PORTABLE_PG_DRIVER'])
import psycopg
p=json.load(sys.stdin)
try:
    with psycopg.connect(p['connectionURL']) as c:
        with c.cursor() as x:
            if p['action']=='seed':
                x.execute("SELECT public FROM storage.buckets WHERE name='portable-apps'")
                assert x.fetchone()==(False,), 'Private bucket required'
                x.execute("INSERT INTO public.categories(id,label) VALUES ('it','Portable cloud synthetic IT') ON CONFLICT DO NOTHING RETURNING id")
                category_created=x.fetchone() is not None
                x.execute('INSERT INTO public.plans(id,name) VALUES (%s,%s)',(p['plan'],'Portable cloud synthetic '+p['plan']))
                for org in p['orgs']:
                    x.execute('INSERT INTO public.organizations(id,name,plan_id,admin_id) VALUES (%s,%s,%s,%s)',(org['id'],'Portable cloud synthetic '+org['id'],p['plan'],org['admin']))
                for u in p['users']:
                    x.execute('INSERT INTO public.users(id,org_id,email,username,role,name,invitation_state) VALUES (%s,%s,%s,%s,%s,%s,%s)',(u['id'],u['org'],u['email'],u['username'],u['role'],'Portable cloud synthetic','sent'))
                for u in p['users']:
                    x.execute("INSERT INTO auth.users(id,email,password,email_verified) VALUES (%s,%s,crypt(%s,gen_salt('bf')),true)",(u['auth'],u['email'],u['password']))
                x.execute('SET CONSTRAINTS ALL IMMEDIATE')
                print(json.dumps({'seeded':True,'category_created':category_created}))
            elif p['action']=='disable':
                ids=[u['auth'] for u in p['users']]
                x.execute('UPDATE auth.users SET password=NULL,email_verified=false WHERE id=ANY(%s::uuid[])',(ids,))
                x.execute("UPDATE public.users SET enabled=false WHERE auth_user_id=ANY(%s::uuid[]) AND role<>'admin'",(ids,))
                print(json.dumps({'disabled':True}))
            elif p['action']=='verify_cleanup':
                ids=[u['auth'] for u in p['users']]
                x.execute('SELECT count(*),count(password),count(*) FILTER (WHERE email_verified) FROM auth.users WHERE id=ANY(%s::uuid[])',(ids,))
                assert x.fetchone()==(len(ids),0,0), 'Synthetic auth revocation failed'
                x.execute("SELECT count(*) FROM public.users WHERE auth_user_id=ANY(%s::uuid[]) AND role<>'admin' AND enabled",(ids,))
                assert x.fetchone()==(0,), 'Synthetic non-admin deactivation failed'
                print(json.dumps({'cleanup_verified':True}))
            elif p['action']=='probe':
                developer=p['users'][1]
                x.execute('SET LOCAL ROLE authenticated')
                x.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':developer['auth'],'role':'authenticated'}),))
                statement="""INSERT INTO storage.objects (bucket,key,size,mime_type,uploaded_by,uploaded_via)
                    VALUES (%s,%s,%s,%s,%s,'rest') ON CONFLICT (bucket,key) DO UPDATE SET
                    size=EXCLUDED.size,mime_type=EXCLUDED.mime_type,uploaded_via=EXCLUDED.uploaded_via"""
                results=[]
                for size,mime in [(p['probe']['size'],'text/html'),(p['probe']['size'],'application/octet-stream'),(0,'text/html')]:
                    x.execute('SAVEPOINT portable_probe')
                    try:
                        x.execute(statement,('portable-apps',p['probe']['key'],size,mime,developer['auth']))
                        results.append({'size':size,'mime':mime,'allowed':True})
                    except psycopg.Error as e:
                        results.append({'size':size,'mime':mime,'allowed':False,'sqlstate':e.sqlstate,'message':e.diag.message_primary})
                    finally:
                        x.execute('ROLLBACK TO SAVEPOINT portable_probe')
                        x.execute('RELEASE SAVEPOINT portable_probe')
                print(json.dumps({'probeSQL':statement,'results':results}))
            elif p['action']=='inspect':
                x.execute("SELECT key,size,mime_type,uploaded_by FROM storage.objects WHERE bucket='portable-apps' AND uploaded_by=ANY(%s::text[]) ORDER BY key",([u['auth'] for u in p['users']],))
                print(json.dumps({'objects':[{'key':r[0],'size':r[1],'mime':r[2],'owner':r[3]} for r in x.fetchall()]}))
except Exception as e:
    print(json.dumps({'error':type(e).__name__,'sqlstate':getattr(e,'sqlstate',None)}))
    sys.exit(1)
`;
function sql(action) {
  const result = spawnSync('python', ['-c', python], {
    input: JSON.stringify({ ...fixture, action }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  let data;
  try { data = JSON.parse(result.stdout); } catch { throw new Error('Python/psycopg unavailable; set PORTABLE_PG_DRIVER'); }
  assert.equal(result.status, 0, `SQL ${action}: ${data.error || 'unknown'} (${data.sqlstate || 'none'})`);
  return data;
}
function ok(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code || 'SDK_ERROR'} HTTP ${result.error.statusCode || '?'}: ${result.error.message || ''}`);
  assert.notEqual(result.data, null, `${label}: missing data`);
  console.log(`PASS ${label}`);
  return result.data;
}
function denied(result, label) {
  assert.ok(result.error, `${label}: unexpectedly succeeded`);
  console.log(`PASS ${label} (${result.error.code || 'SDK_ERROR'}, HTTP ${result.error.statusCode || '?'})`);
}
async function download(client, key, expected, label, mime) {
  const blob = ok(await client.storage.from('portable-apps').download(key), label);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(expected), `${label}: bytes changed`);
  if (mime) assert.equal(blob.type.split(';')[0], mime, `${label}: MIME changed`);
}
async function immutable(client, key, original, label) {
  const replacement = new File([' '.repeat(original.length)], 'data.json', { type: 'application/json' });
  const result = await client.storage.from('portable-apps').upload(key, replacement);
  console.log(`${label} overwrite response: ${result.error ? `${result.error.code}, HTTP ${result.error.statusCode}` : 'success/no-op'}`);
  await download(client, key, original, `${label} overwrite preserves bytes`);
  const removed = await client.storage.from('portable-apps').remove(key);
  console.log(`${label} delete response: ${removed.error ? `${removed.error.code}, HTTP ${removed.error.statusCode}` : 'success/no-op'}`);
  await download(client, key, original, `${label} delete preserves bytes`);
}
async function main() {
  assert.equal(process.env.PORTABLE_STORAGE_CLOUD, '1', 'Explicit PORTABLE_STORAGE_CLOUD=1 required');
  ({ createClient } = await import('@insforge/sdk'));
  const current = cli('current');
  assert.ok(current.includes('studio-portable-apps') && current.includes(baseUrl), 'Refusing non-disposable or different CLI target');
  const connectionURL = JSON.parse(cli('db connection-string --json')).connectionURL;
  assert.ok(connectionURL, 'Missing connectionURL');
  const secret = JSON.parse(cli('secrets get ANON_KEY --json'));
  const anonKey = typeof secret === 'string' ? secret : secret.value || secret.secret?.value || secret.data?.value;
  assert.ok(anonKey, `Missing anon key; response fields: ${Object.keys(secret).join(',')}`);
  const suffix = randomBytes(8).toString('hex');
  const org = randomUUID();
  const foreignOrg = randomUUID();
  const users = ['admin', 'developer', 'catalog', 'foreign'].map(role => ({
    id: randomUUID(), auth: randomUUID(), org: role === 'foreign' ? foreignOrg : org,
    role: role === 'foreign' ? 'admin' : role, label: role,
    email: `portable-${role}-${suffix}@example.invalid`, username: `portable-${role}-${suffix}`,
    password: `X!${randomBytes(30).toString('base64url')}9a`,
  }));
  fixture = { connectionURL, plan: randomUUID(), orgs: [{ id: org, admin: users[0].id }, { id: foreignOrg, admin: users[3].id }], users };
  stage = 'SQL branch-only fixture';
  sql('seed');
  console.log('PASS private bucket and committed branch-only synthetic fixtures');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = new URL(typeof args[0] === 'string' ? args[0] : args[0].url || String(args[0]));
    if (url.origin === baseUrl && url.pathname.endsWith('/upload-strategy')) {
      const body = JSON.parse(args[1]?.body || '{}');
      console.log('Sanitized strategy request:', JSON.stringify({ filename: body.filename, contentType: body.contentType, size: body.size }));
    }
    const response = await originalFetch(...args);
    if (url.origin === baseUrl && url.pathname.includes('/api/storage/')) {
      console.log(`HTTP ${args[1]?.method || 'GET'} ${url.pathname} -> ${response.status}`);
      if (url.pathname.includes('strategy') && response.ok) {
        const body = await response.clone().json();
        if (body.method) console.log(`Storage strategy: ${body.method}`);
      }
    }
    return response;
  };
  try {
    for (const user of users) {
      stage = `SDK sign in ${user.label}`;
      const client = createClient({ baseUrl, anonKey });
      const session = ok(await client.auth.signInWithPassword({ email: user.email, password: user.password }), stage);
      assert.ok(session.accessToken, 'Normal bearer session missing');
      assert.equal(session.user.id, user.auth);
      clients.push(client);
    }
    const [admin, developer, catalog, foreign] = clients;
    stage = 'SDK reservation';
    const html = '<!doctype html><html><body>Portable synthetic fixture</body></html>';
    const json = '{"synthetic":true,"value":42}';
    const files = [new File([html], 'app.html', { type: 'text/html' }), new Blob([json], { type: 'application/json' })];
    const metadata = files.map((file, i) => ({ name: i === 0 ? 'app.html' : 'data.json', type: file.type, size: file.size }));
    const reservation = ok(await developer.database.rpc('tk_portable_reserve', { p_files: metadata }), stage);
    const htmlKey = `${reservation.id}/app.html`;
    const jsonKey = `${reservation.id}/data.json`;
    assert.equal(ok(await developer.database.rpc('tk_portable_storage_file', {
      p_key: htmlKey, p_size: files[0].size, p_type: files[0].type,
    }), 'bearer reserved HTML policy helper'), true);
    if (process.env.PORTABLE_STORAGE_DIAG === '1') {
      fixture.probe = { key: htmlKey, size: files[0].size };
      console.log('Rollback-only strategy SQL probes:', JSON.stringify(sql('probe')));
    }
    stage = 'SDK reserved File HTML upload';
    const upload = ok(await developer.storage.from('portable-apps').upload(htmlKey, files[0]), stage);
    assert.equal(upload.key, htmlKey);
    stage = 'SDK reserved Blob JSON upload';
    assert.equal(ok(await developer.storage.from('portable-apps').upload(jsonKey, files[1]), stage).key, jsonKey);
    const rows = sql('inspect').objects;
    for (const file of metadata) {
      const row = rows.find(row => row.key === `${reservation.id}/${file.name}`);
      assert.equal(row?.mime, file.type === 'text/html' ? 'application/octet-stream' : file.type);
      assert.equal(row?.size, file.size);
      assert.equal(row?.owner, users[1].auth);
    }
    console.log('PASS stored reservation key, MIME, size and bearer owner');
    denied(await developer.storage.from('portable-apps').upload(`${reservation.id}/unreserved.json`, files[1]), 'unreserved filename rejected');
    stage = 'pre-submit immutability';
    await immutable(developer, jsonKey, json, stage);
    await immutable(developer, htmlKey, html, `${stage} HTML`);
    stage = 'SDK submission';
    const app = ok(await developer.database.rpc('tk_portable_submit', {
      p_upload: reservation.id, p_fields: { title: 'Portable cloud synthetic', desc: 'Synthetic disposable branch-only portable storage HTTP integration fixture.', area: 'it', generatedHtml: html },
      p_id: null, p_version: null,
    }), stage);
    stage = 'pending download authorization';
    denied(await catalog.storage.from('portable-apps').download(jsonKey), 'pending catalog download denied');
    denied(await foreign.storage.from('portable-apps').download(jsonKey), 'foreign admin download denied');
    await download(admin, htmlKey, html, 'own-org admin pending HTML download', 'application/octet-stream');
    await download(admin, jsonKey, json, 'own-org admin pending JSON download', 'application/json');
    stage = 'post-submit immutability';
    await immutable(developer, jsonKey, json, stage);
    stage = 'SDK approval';
    ok(await admin.database.rpc('tk_command', { p_action: 'reviewApp', p_id: app.id, p_fields: { action: 'approved', checks: { security: true, data: true } }, p_version: 1 }), stage);
    stage = 'approved catalog download';
    await download(catalog, htmlKey, html, 'approved current catalog HTML download', 'application/octet-stream');
    await download(catalog, jsonKey, json, 'approved current catalog JSON download', 'application/json');
    denied(await foreign.storage.from('portable-apps').download(jsonKey), 'foreign admin approved download denied');
    stage = 'approved admin immutability';
    await immutable(admin, jsonKey, json, stage);
    await immutable(admin, htmlKey, html, `${stage} HTML`);
    console.log('PASS all real bearer SDK storage assertions');
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch(error => {
  console.error(`FAIL ${stage}: ${error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  for (const client of clients) await client.auth.signOut().catch(() => {});
  if (fixture) {
    try { sql('disable'); sql('verify_cleanup'); console.log('PASS persisted fixture credential revocation and non-admin deactivation. Branch owner MUST destroy disposable branch after schema-only merge; synthetic rows/objects remain.'); }
    catch (error) { console.error(`Fixture deactivation failed (${error.message}); branch owner MUST destroy branch before reuse.`); process.exitCode = 1; }
  }
});
