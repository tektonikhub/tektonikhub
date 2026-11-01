'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { randomBytes, createHmac } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const kit = require('../lib/studio/runtime/dashboard-kit.js');
const root = path.resolve(__dirname, '..');
const endpoint = 'https://myviarapida-resource.services.ai.azure.com/openai/v1/responses';
const otherEndpoint = 'https://second-test.openai.azure.com/openai/v1/responses';
const orgId = '00000000-0000-4000-8000-000000000001';
const otherOrgId = '00000000-0000-4000-8000-000000000002';
const systemOrgId = '00000000-0000-4000-8000-000000000003';
const planId = '00000000-0000-4000-8000-000000000004';
const fakeKey = 'synthetic-azure-not-a-real-key';
const fakeOtherKey = 'synthetic-other-organization-key';
const roles = ['admin', 'developer', 'catalog', 'superadmin', 'otheradmin'];
const accounts = roles.map((role, index) => ({
  role: role === 'otheradmin' ? 'admin' : role, enabled: true, verified: true,
  id: `00000000-0000-4000-8000-00000000010${index}`,
  authId: `00000000-0000-4000-8000-00000000020${index}`,
  orgId: role === 'superadmin' ? systemOrgId : role === 'otheradmin' ? otherOrgId : orgId,
}));
const signingKey = randomBytes(32), tokens = new Map(), settings = new Map();
const expectedKeys = new Map([[endpoint, fakeKey], [otherEndpoint, fakeOtherKey]]);
let base, environment, next, browser, logs = '', mode = 'valid', azureCalls = 0, cancelled = false;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function issue(account) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: account.authId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const token = `${header}.${payload}.${createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')}`;
  tokens.set(token, account);
  return token;
}
function identity(account) { return { userId: account.id, orgId: account.orgId, role: account.role }; }
function allowed(account, id, admin = false) {
  return account?.enabled && account.verified && (account.role === 'superadmin' || account.orgId === id)
    && (admin ? ['admin', 'superadmin'] : ['developer', 'admin', 'superadmin']).includes(account.role);
}
function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function dbError(response, code, message) { return send(response, code === '42501' ? 403 : 409, { code, message }); }
function workspace(account) {
  const ids = account.role === 'superadmin' ? [orgId, otherOrgId, systemOrgId] : [account.orgId];
  return {
    session: identity(account), revision: 0,
    organizations: ids.map(id => ({
      id, name: 'Synthetic organization', initials: 'SO', plan: planId, members: 3, compliance: null, status: 'active',
      adminId: accounts.find(value => value.orgId === id && ['admin', 'superadmin'].includes(value.role)).id,
      createdAt: '2026-01-01T00:00:00Z', date: '2026-01-01', domain: '', lastAccess: '', system: id === systemOrgId,
    })),
    users: accounts.filter(value => ids.includes(value.orgId)).map(value => ({
      id: value.id, orgId: value.orgId, role: value.role, name: 'Synthetic user', initials: 'SU', dept: '',
      email: `${value.id}@example.invalid`, username: `user-${value.id.slice(-3)}`, enabled: true, accountStatus: 'active', deletedAt: null,
    })),
    plans: [{ id: planId, name: 'Synthetic plan', price: 0 }], categories: [{ id: 'ventas', label: 'Ventas' }],
    apps: [], reviews: [], events: [], policies: [],
  };
}
function completed(value) {
  return { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}
const backend = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8'), body = text ? JSON.parse(text) : {};
    const token = request.headers.authorization?.replace(/^Bearer /i, ''), account = tokens.get(token);
    if (url.pathname === '/api/auth/sessions/current') {
      return account ? send(response, 200, { user: {
        id: account.authId, email: `${account.id}@example.invalid`, emailVerified: account.verified, isAnonymous: false,
      } }) : send(response, 401, { statusCode: 401, error: 'AUTH_UNAUTHORIZED', message: 'Synthetic account required' });
    }
    if (url.pathname === '/api/database/rpc/tk_identity') return send(response, 200, account?.enabled && account.verified ? identity(account) : null);
    if (url.pathname === '/api/database/rpc/tk_workspace') return send(response, 200, workspace(account));
    if (url.pathname === '/api/database/rpc/tk_flow_entries') return send(response, 200, []);
    if (url.pathname === '/api/database/records/organization_azure') {
      const id = url.searchParams.get('org_id')?.replace(/^eq\./, '');
      if (!allowed(account, id)) return dbError(response, '42501', 'Synthetic organization denied');
      assert.notEqual(token, environment.INSFORGE_API_KEY, 'Credentials must use the authenticated SDK client, never an admin bypass');
      assert.equal(url.searchParams.get('limit'), '1');
      const columns = url.searchParams.get('select').split(',');
      assert.ok(columns.every(column => ['endpoint', 'deployment', 'api_version', 'version', 'encrypted_key'].includes(column)));
      const row = settings.get(id);
      return send(response, 200, row ? [Object.fromEntries(columns.map(column => [column, row[column]]))] : []);
    }
    if (url.pathname.startsWith('/api/database/rpc/tk_azure_')) {
      const name = url.pathname.split('/').at(-1), admin = ['tk_azure_save', 'tk_azure_clear'].includes(name);
      if (!allowed(account, body.p_org, admin)) return dbError(response, '42501', 'Synthetic organization denied');
      assert.notEqual(token, environment.INSFORGE_API_KEY);
      const row = settings.get(body.p_org);
      if (name === 'tk_azure_save' || name === 'tk_azure_clear') {
        if ((row?.version || 0) !== body.p_version || row?.lease) return dbError(response, '40001', 'Synthetic concurrent configuration');
        if (name === 'tk_azure_clear') settings.delete(body.p_org);
        else {
          assert.equal(body.p_api_version, 'v1');
          assert.match(body.p_endpoint, /\/openai\/v1\/responses$/);
          assert.match(body.p_encrypted_key, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
          assert.ok(!body.p_encrypted_key.includes(fakeKey) && !body.p_encrypted_key.includes(fakeOtherKey));
          settings.set(body.p_org, {
            endpoint: body.p_endpoint, deployment: body.p_deployment, api_version: body.p_api_version,
            encrypted_key: body.p_encrypted_key, version: (row?.version || 0) + 1, calls: row?.calls || 0, lease: null,
          });
        }
        return send(response, 200, null);
      }
      if (name === 'tk_azure_claim') {
        if (!row) return dbError(response, 'P0001', 'Configure Azure');
        if (row.lease || row.calls >= 12) return send(response, 200, false);
        row.calls++; row.lease = body.p_lease;
        return send(response, 200, true);
      }
      if (name === 'tk_azure_release') {
        if (row?.lease === body.p_lease) row.lease = null;
        return send(response, 200, null);
      }
    }
    if (url.pathname === '/mock/azure/responses') {
      azureCalls++;
      assert.equal(request.headers['api-key'], expectedKeys.get(request.headers['x-mock-azure-url']));
      assert.equal(body.text.format.type, 'json_object'); assert.equal(body.store, false);
      assert.equal(body.messages, undefined); assert.equal(body.api_version, undefined);
      assert.equal(typeof body.model, 'string'); assert.ok(body.max_output_tokens >= 256);
      if (!/json/i.test(JSON.stringify(body.input))) {
        return send(response, 400, { error: {
          message: "'input' must contain the word 'json' in some form, to use 'text.format' of type 'json_object'.",
          type: 'invalid_request_error', param: 'input', code: null,
        } });
      }
      if (mode === 'block') {
        response.on('close', () => { if (!response.writableEnded) cancelled = true; });
        return;
      }
      if (mode === 'unauthorized') return send(response, 401, { error: { message: fakeKey } });
      if (mode === 'quota') return send(response, 429, { error: { message: fakeKey } });
      if (mode === 'upstream') return send(response, 500, { error: { message: fakeKey } });
      if (mode === 'bad-input') return send(response, 400, { error: { param: 'input', message: fakeKey } });
      if (mode === 'bad-model') return send(response, 400, { error: { param: 'model', message: fakeKey } });
      if (mode === 'unsupported-json') return send(response, 400, { error: { code: 'unsupported_value', param: 'text.format.type', message: fakeKey } });
      if (mode === 'unsupported-responses') return send(response, 400, { error: { code: 'OperationNotSupported', message: fakeKey } });
      if (mode === 'missing-deployment') return send(response, 404, { error: { code: 'DeploymentNotFound', message: fakeKey } });
      if (mode === 'unknown-error') return send(response, 400, { error: { code: fakeKey, param: fakeKey, message: fakeKey } });
      if (mode === 'error-not-json') { response.writeHead(400, { 'Content-Type': 'text/html' }); response.end(fakeKey); return; }
      if (mode === 'error-too-large') return send(response, 400, { error: { message: fakeKey }, padding: 'x'.repeat(17000) });
      if (mode === 'not-json') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<html>Not JSON</html>'); return; }
      if (mode === 'too-large') return send(response, 200, { padding: 'x'.repeat(250000) });
      if (mode === 'incomplete') return send(response, 200, { ...completed({}), status: 'incomplete' });
      if (mode === 'refusal') return send(response, 200, { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'No' }] }] });
      if (mode === 'invalid-json') return send(response, 200, { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'not JSON' }] }] });
      if (body.input === 'Return only the JSON object {"ok":true}.') return send(response, 200, completed({ ok: true }));
      const input = JSON.parse(body.input);
      assert.equal(input.outputFormat, 'JSON');
      assert.ok(body.instructions.includes('"schema"'));
      return send(response, 200, completed(mode === 'invalid-config' ? { script: 'alert(1)' } : kit.createConfig(input.request, input.previous)));
    }
    throw new Error(`Unexpected synthetic endpoint ${request.method} ${url.pathname}`);
  } catch (error) {
    logs += `\nSynthetic backend: ${error.message}`;
    send(response, 500, { statusCode: 500, error: 'MOCK_ERROR', message: error.message });
  }
});
async function availablePort() {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
function stopOwnedTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const script = `function Stop-Owned([int]$processId) { Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" | ForEach-Object { Stop-Owned $_.ProcessId }; Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }; Stop-Owned ${child.pid}`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  } else { try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
}
async function build() {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'sync-public.cjs')], { cwd: root, env: environment, stdio: 'pipe' });
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'build', '--webpack'], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output = (output + value).slice(-20000); });
  child.stderr.on('data', value => { output = (output + value).slice(-20000); });
  const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(status, 0, `Production build failed:\n${output}`);
}
async function start(overrides = {}) {
  next = spawn(process.execPath, [
    '--require', path.join(root, 'tests', 'fixtures', 'azure-fetch.cjs'),
    require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(base).port,
  ], { cwd: root, env: { ...environment, ...overrides }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const append = value => { logs = (logs + value).slice(-16000); };
  next.stdout.on('data', append); next.stderr.on('data', append);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (next.exitCode !== null) throw new Error(`Production Next exited: ${logs}`);
    try { if ((await fetch(base + '/login', { signal: AbortSignal.timeout(2000) })).ok) return; }
    catch (error) { if (!['TimeoutError', 'TypeError'].includes(error.name)) throw error; }
    await wait(200);
  }
  throw new Error(`Production Next did not start: ${logs}`);
}
async function restart(overrides = {}) {
  stopOwnedTree(next);
  await wait(300);
  await start(overrides);
}
async function main() {
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  try {
    base = `http://127.0.0.1:${await availablePort()}`;
    environment = {
      ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', BLK_ENABLE_LOCAL_LLM: 'false',
      NEXT_PUBLIC_INSFORGE_URL: `http://127.0.0.1:${backend.address().port}`, NEXT_PUBLIC_INSFORGE_ANON_KEY: 'synthetic-anon-key',
      INSFORGE_API_KEY: 'synthetic-admin-key', AZURE_SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      APP_URL: base, NEXT_PUBLIC_APP_URL: base, TEKTONIK_TEST_BACKEND: `http://127.0.0.1:${backend.address().port}`,
    };
    await build(); await start();
    const sessions = {};
    const get = (url, role) => fetch(base + url, { headers: role ? { Cookie: sessions[role].cookie } : {} });
    const post = (url, body, role = 'admin', options = {}) => fetch(base + url, {
      method: 'POST', headers: { Cookie: sessions[role]?.cookie || '', Origin: base, 'Content-Type': 'application/json', 'X-BLK-CSRF': sessions[role]?.csrf || '', ...options.headers },
      body: JSON.stringify(body), ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'headers')),
    });
    const fields = { orgId, endpoint, deployment: 'synthetic-dashboard-model', apiKey: fakeKey, version: 0 };
    assert.equal((await get('/api/session')).status, 401);
    assert.equal((await get('/api/llm/settings?orgId=' + orgId)).status, 401);
    for (let index = 0; index < roles.length; index++) {
      const role = roles[index], token = issue(accounts[index]);
      sessions[role] = { token, cookie: `insforge_access_token=${token}` };
      const response = await get('/api/session', role);
      assert.equal(response.status, role === 'catalog' ? 403 : 200);
      const body = await response.json();
      if (role !== 'catalog') { assert.match(body.csrf, /^[a-f0-9]{64}$/); assert.equal(body.localOnly, undefined); sessions[role].csrf = body.csrf; }
    }
    let response = await get('/api/llm/settings?orgId=' + orgId, 'admin');
    assert.equal(response.status, 200); assert.equal((await response.json()).configured, false);
    assert.equal((await get('/api/llm/settings?orgId=' + orgId, 'otheradmin')).status, 403);
    assert.equal((await get('/api/llm/settings?orgId=' + orgId, 'catalog')).status, 403);
    assert.equal((await post('/api/llm/settings', fields, 'developer')).status, 403);
    assert.equal((await post('/api/llm/test', { orgId }, 'developer')).status, 403);
    assert.equal((await post('/api/studio/generate', { orgId, prompt: 'ventas' }, 'developer')).status, 409);
    console.log('PASS: production uses verified server identity, Admin-only configuration and organization isolation without a local bridge');
    for (const change of [{ endpoint: 'https://127.0.0.1/openai/v1/responses' }, { deployment: '' }, { apiKey: '' }, { version: undefined }]) {
      assert.equal((await post('/api/llm/settings', { ...fields, ...change })).status, 400);
    }
    assert.equal((await post('/api/llm/settings', fields, 'admin', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await post('/api/llm/settings', fields, 'admin', { headers: { 'X-BLK-CSRF': '0'.repeat(64) } })).status, 403);
    assert.equal((await post('/api/llm/settings', fields, 'admin', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await post('/api/llm/settings', { ...fields, padding: 'x'.repeat(250000) })).status, 413);
    assert.equal((await post('/api/llm/settings', {}, 'admin', { body: 'not-json' })).status, 400);
    assert.equal((await post('/api/llm/settings', {}, 'admin', { body: new Uint8Array([0x22, 0xff, 0x22]) })).status, 400);
    assert.equal((await post('/api/llm/unknown', { orgId })).status, 404);
    assert.equal(azureCalls, 0);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      await context.addCookies([{ name: 'insforge_access_token', value: sessions.admin.token, url: base, sameSite: 'Lax' }]);
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(base + '/admin');
      await page.getByRole('button', { name: 'Configuración org · LLM Settings', exact: true }).click();
      await page.getByLabel('Endpoint HTTPS').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('.studio-llm fieldset')?.disabled === false);
      assert.doesNotMatch(await page.locator('.studio-llm').innerText(), /BLK_ENABLE_LOCAL_LLM|desarrollo local|memoria del servidor local/);
      await page.getByLabel('Endpoint HTTPS').fill(endpoint);
      await page.getByLabel('Modelo desplegado (deployment)').fill(fields.deployment);
      await page.getByLabel('API key', { exact: true }).fill(fakeKey);
      await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
      await page.getByText(/Configuración guardada para los usuarios/).waitFor();
      assert.equal(await page.getByLabel('API key', { exact: true }).inputValue(), '');
      assert.ok(!JSON.stringify(settings.get(orgId)).includes(fakeKey));
      assert.equal(azureCalls, 0, 'Saving must not consume Azure quota');
      assert.equal(await page.evaluate(key => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(key), fakeKey), false);
      await page.reload();
      await page.getByRole('button', { name: 'Configuración org · LLM Settings', exact: true }).click();
      await page.getByText(/Azure configurado para esta organización\./).waitFor();
      assert.equal(await page.getByLabel('Endpoint HTTPS').inputValue(), endpoint);
      assert.equal(await page.getByLabel('API key', { exact: true }).inputValue(), '');
      const connection = page.waitForResponse(response => new URL(response.url()).pathname === '/api/llm/test' && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Probar conexión (consume cuota)', exact: true }).click();
      const connectionResponse = await connection;
      assert.equal(connectionResponse.status(), 200, await connectionResponse.text());
      await page.getByText(/Conexión y JSON verificados con Azure Responses v1/).waitFor();
    } finally { await context.close(); }
    response = await get('/api/llm/settings?orgId=' + orgId, 'developer');
    const configured = await response.json();
    assert.equal(configured.storage, 'insforge'); assert.equal(configured.apiVersion, 'v1'); assert.equal(configured.version, 1);
    assert.ok(!JSON.stringify(configured).includes(fakeKey)); assert.equal(configured.encrypted_key, undefined);
    response = await post('/api/studio/generate', { orgId, prompt: 'Crea un dashboard de ventas con tabla y gráfico' }, 'developer');
    assert.equal(response.status, 200, await response.clone().text());
    const generated = await response.json();
    assert.equal(generated.provider, 'azure-openai'); assert.equal(generated.model, fields.deployment);
    assert.equal(kit.validate(generated.config).template, 'sales'); assert.ok(!JSON.stringify(generated).includes(fakeKey));
    response = await post('/api/studio/generate', { orgId, prompt: 'Ponlo en modo oscuro', previous: generated.config }, 'developer');
    assert.equal(response.status, 200);
    const iteration = await response.json();
    assert.equal(iteration.config.theme.dark, true); assert.deepEqual(iteration.config.data, generated.config.data);
    assert.equal((await post('/api/studio/generate', { orgId, prompt: 'ventas', previous: { script: 'evil' } }, 'developer')).status, 400);
    console.log('PASS: Admin UI saves encrypted credentials to InsForge, reloads metadata without keys and users generate validated Azure Responses JSON');
    await restart({ BLK_ENABLE_LOCAL_LLM: 'true' });
    response = await get('/api/llm/settings?orgId=' + orgId, 'admin');
    assert.equal((await response.json()).version, 1);
    assert.equal((await post('/api/llm/test', { orgId })).status, 200);
    const encrypted = settings.get(orgId).encrypted_key;
    response = await post('/api/llm/settings', { ...fields, deployment: 'updated-model', apiKey: '', version: 1 });
    assert.equal(response.status, 200); assert.equal((await response.json()).version, 2);
    assert.notEqual(settings.get(orgId).encrypted_key, encrypted);
    assert.equal((await post('/api/llm/settings', { ...fields, version: 1 })).status, 409);
    assert.equal((await post('/api/llm/clear', { orgId, version: 1 })).status, 409);
    assert.equal((await post('/api/llm/test', { orgId })).status, 200);
    response = await post('/api/llm/settings', { orgId: otherOrgId, endpoint: otherEndpoint, deployment: 'other-model', apiKey: fakeOtherKey, version: 0 }, 'superadmin');
    assert.equal(response.status, 200);
    assert.equal((await post('/api/llm/test', { orgId: otherOrgId }, 'otheradmin')).status, 200);
    assert.equal((await post('/api/studio/generate', { orgId: otherOrgId, prompt: 'ventas' }, 'developer')).status, 403);
    const otherSettings = settings.get(otherOrgId);
    settings.set(otherOrgId, { ...settings.get(orgId), endpoint: otherSettings.endpoint, calls: 0, lease: null });
    response = await post('/api/llm/test', { orgId: otherOrgId }, 'superadmin');
    assert.equal(response.status, 503); assert.ok(!(await response.text()).includes(fakeKey));
    settings.set(otherOrgId, otherSettings);
    console.log('PASS: credentials survive production restarts, blank-key updates re-encrypt, stale writes fail and tenant-bound ciphertext cannot be reused');
    settings.get(orgId).calls = 0;
    mode = 'block'; cancelled = false;
    const before = azureCalls, abort = new AbortController();
    const pending = post('/api/studio/generate', { orgId, prompt: 'ventas' }, 'developer', { signal: abort.signal });
    for (let attempt = 0; attempt < 50 && azureCalls === before; attempt++) await wait(100);
    assert.equal(azureCalls, before + 1);
    assert.equal((await post('/api/llm/test', { orgId })).status, 429);
    assert.equal((await post('/api/llm/settings', { ...fields, version: 2 })).status, 409);
    assert.equal((await post('/api/llm/clear', { orgId, version: 2 })).status, 409);
    abort.abort(); await assert.rejects(pending);
    for (let attempt = 0; attempt < 80 && (!cancelled || settings.get(orgId).lease); attempt++) await wait(100);
    assert.equal(cancelled, true, 'Client cancellation must reach Azure');
    assert.equal(settings.get(orgId).lease, null, 'Cancellation must release the durable lease');
    mode = 'valid';
    assert.equal((await post('/api/llm/test', { orgId })).status, 200);
    for (const [nextMode, status, expectedError] of [
      ['unauthorized', 502], ['quota', 429], ['upstream', 502], ['not-json', 502], ['too-large', 502],
      ['incomplete', 422], ['refusal', 422], ['invalid-json', 422], ['invalid-config', 422],
      ['bad-input', 502, /JSON explícitamente/], ['bad-model', 502, /nombre exacto del deployment/],
      ['unsupported-json', 502, /formato JSON/], ['unsupported-responses', 502, /no admite esta operación/],
      ['missing-deployment', 502, /nombre exacto de un deployment/], ['unknown-error', 502, /HTTP 400/],
      ['error-not-json', 502, /HTTP 400/], ['error-too-large', 502, /HTTP 400/],
    ]) {
      settings.get(orgId).calls = 0; mode = nextMode;
      const callsBefore = azureCalls;
      response = await post('/api/studio/generate', { orgId, prompt: 'ventas' }, 'developer');
      assert.equal(response.status, status, nextMode);
      const body = await response.json();
      if (expectedError) assert.match(body.error, expectedError);
      assert.equal(azureCalls, callsBefore + 1, 'Rejected requests must not be retried or silently downgrade JSON mode');
      assert.equal(body.config, undefined); assert.ok(!JSON.stringify(body).includes(fakeKey)); assert.equal(settings.get(orgId).lease, null);
    }
    mode = 'valid'; settings.get(orgId).calls = 0;
    const quotaStart = azureCalls;
    for (let index = 0; index < 12; index++) assert.equal((await post('/api/llm/test', { orgId })).status, 200);
    assert.equal((await post('/api/llm/test', { orgId })).status, 429);
    assert.equal(azureCalls - quotaStart, 12);
    console.log('PASS: shared concurrency, exact 12/minute quota, cancellation and explicit upstream/schema failures without credential leakage or demo fallback');
    await restart({ AZURE_SETTINGS_ENCRYPTION_KEY: '' });
    response = await get('/api/llm/settings?orgId=' + orgId, 'admin');
    assert.equal(response.status, 503); assert.match((await response.json()).error, /clave de cifrado/);
    await restart(); settings.get(orgId).calls = 0;
    assert.equal((await post('/api/llm/test', { orgId })).status, 200);
    accounts[0].enabled = false;
    assert.equal((await get('/api/llm/settings?orgId=' + orgId, 'admin')).status, 403);
    accounts[0].enabled = true;
    response = await post('/api/llm/clear', { orgId, version: 2 });
    assert.equal(response.status, 200); assert.equal((await response.json()).configured, false);
    assert.equal(settings.has(orgId), false);
    assert.equal((await post('/api/studio/generate', { orgId, prompt: 'ventas' }, 'developer')).status, 409);
    console.log('PASS: missing encryption configuration and disabled accounts fail explicitly; Admin removal disables organization generation');
  } finally {
    if (browser) await browser.close();
    stopOwnedTree(next);
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
  }
}
main().catch(error => { console.error(error); if (logs) console.error(logs); process.exitCode = 1; });
