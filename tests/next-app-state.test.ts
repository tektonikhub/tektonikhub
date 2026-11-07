import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';
import { chromium } from 'playwright';
import { appStateSchema, appStorageScript, loadAppState, saveAppState, stateMessage } from '../lib/studio/app-state';
import { OFFLINE_CSP } from '../lib/studio/engines';

const id = '00000000-0000-4000-8000-000000000001';
test('private storage validates bounded plain string records and exact message envelopes', () => {
  assert.deepEqual(appStateSchema.parse({ tasks: '[{"name":"Real"}]' }), { tasks: '[{"name":"Real"}]' });
  for (const input of [null, [], { tasks: [] }, { tasks: 1 }, { ['a'.repeat(121)]: 'x' }, { tasks: '界'.repeat(70000) }, Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), '']))]) {
    assert.equal(appStateSchema.safeParse(input).success, false);
  }
  assert.deepEqual(stateMessage({ type: 'tektonik:state', channel: 'correct', state: { key: 'value' } }, 'correct'), { key: 'value' });
  assert.equal(stateMessage({ type: 'tektonik:state', channel: 'wrong', state: {} }, 'correct'), null);
  assert.equal(stateMessage({ type: 'tektonik:state', channel: 'correct', state: {}, appId: id }, 'correct'), null);
});
test('Web Storage shim has synchronous hydration, real storage methods, quota and script-safe content', () => {
  const messages: unknown[] = [];
  const window: Record<string, unknown> = {};
  const source = appStorageScript({ tasks: '</script><script>evil()</script>', counter: '3' }, 'token');
  assert.doesNotMatch(source, /<\/script>/i);
  new Script(source).runInNewContext({ window, parent: { postMessage: (message: unknown) => messages.push(message) }, TextEncoder, DOMException });
  const storage = window.localStorage as Storage;
  assert.equal(storage.getItem('counter'), '3'); assert.equal(storage.length, 2); assert.equal(storage.key(0), 'tasks');
  storage.setItem('counter', '4'); assert.equal(storage.counter, '4');
  storage.tasks = '[]'; assert.equal(storage.getItem('tasks'), '[]');
  delete storage.tasks; assert.equal(storage.getItem('tasks'), null);
  assert.throws(() => storage.setItem('large', 'x'.repeat(200001)), /App storage full/);
  assert.equal(storage.length, 1);
  assert.deepEqual(Object.keys(storage), ['counter']);
  const session = window.sessionStorage as Storage; session.setItem('counter', '9'); assert.equal(session.getItem('counter'), '9');
  const before = messages.length; session.clear(); assert.equal(messages.length, before);
  storage.clear(); assert.equal(storage.length, 0); assert.ok(messages.length >= 4);
});
test('state API requires verified identity, approved current app and locked optimistic private writes', () => {
  const route = readFileSync('app/api/apps/state/route.ts', 'utf8');
  assert.match(route, /sameOrigin\(request\)/); assert.match(route, /authenticatedContext\(\)/); assert.match(route, /appStateSchema/);
  assert.doesNotMatch(route, /identityAdminClient|createAdminClient|NEXT_PUBLIC.*KEY/);
  const sql = readFileSync('migrations/20261107174816_miniapp-private-state.sql', 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /REVOKE ALL ON public\.miniapp_user_state FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /user_id::text = .*userId/); assert.match(sql, /tk_can_use_flow_app/);
  assert.match(sql, /FOR SHARE OF a, o/); assert.match(sql, /current_state.revision <> p_revision/);
  assert.match(sql, /FOR UPDATE/); assert.match(sql, /ON CONFLICT \(user_id, app_id\) DO NOTHING/);
});
test('state client uses same-origin endpoints, strict responses and never hides failure', async () => {
  const original = global.fetch;
  try {
    global.fetch = async (url, options) => {
      assert.match(String(url), /^\/api\/apps\/state/); assert.equal(options?.credentials, 'same-origin');
      return Response.json({ state: { count: '2' }, revision: 1 });
    };
    assert.equal((await loadAppState(id, 2)).revision, 1);
    assert.equal((await saveAppState(id, 2, { count: '2' }, 0)).state.count, '2');
    global.fetch = async () => Response.json({ error: 'Conflicto: recarga' }, { status: 409 });
    await assert.rejects(saveAppState(id, 2, {}, 0), /Conflicto/);
    global.fetch = async () => Response.json({ state: { count: 3 }, revision: 1 });
    await assert.rejects(loadAppState(id, 2));
  } finally { global.fetch = original; }
});
test('opaque-origin functional HTML submits forms, calculates, persists across reload and keeps credentials isolated', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="host"></div>');
    const html = '<!DOCTYPE html><html><head></head><body><h1>Tareas</h1><form id="form"><input id="task" required><button>Crear</button></form><output id="count"></output><ul id="tasks"></ul><script>const rows=JSON.parse(localStorage.getItem("tasks")||"[]");function draw(){document.querySelector("#count").textContent=rows.length*2;document.querySelector("#tasks").replaceChildren(...rows.map(name=>{const li=document.createElement("li");li.textContent=name;return li}));}document.querySelector("#form").onsubmit=e=>{e.preventDefault();rows.push(document.querySelector("#task").value);localStorage.setItem("tasks",JSON.stringify(rows));draw()};draw();</script></body></html>';
    const make = (state: Record<string, string>) => ({ html, script: appStorageScript(state, 'browser-channel'), csp: OFFLINE_CSP });
    const install = async (state: Record<string, string>) => page.evaluate(({ html, script, csp }) => {
      const target = window as unknown as { saved: Record<string, string> }; target.saved = {};
      window.onmessage = event => { const frame = document.querySelector('iframe'); if (event.source === frame?.contentWindow && event.origin === 'null' && event.data.channel === 'browser-channel') target.saved = event.data.state; };
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const bridge = doc.createElement('script'); bridge.textContent = script; doc.head.prepend(bridge);
      const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy'; policy.content = csp; doc.head.prepend(policy);
      const frame = document.createElement('iframe'); frame.sandbox.add('allow-scripts', 'allow-downloads', 'allow-forms'); frame.srcdoc = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
      document.querySelector('#host')!.replaceChildren(frame);
    }, make(state));
    await install({});
    let frame = page.frameLocator('iframe');
    await frame.locator('#task').fill('Preparar informe'); await frame.locator('button').click();
    await frame.locator('#tasks li').waitFor(); assert.equal(await frame.locator('#count').textContent(), '2');
    await page.waitForFunction(() => Boolean((window as unknown as { saved: Record<string, string> }).saved.tasks));
    const saved = await page.evaluate(() => (window as unknown as { saved: Record<string, string> }).saved);
    assert.equal(saved.tasks, '["Preparar informe"]');
    await install(saved); frame = page.frameLocator('iframe');
    await frame.locator('#tasks li').waitFor(); assert.equal(await frame.locator('#tasks li').textContent(), 'Preparar informe');
    const isolation = await frame.locator('body').evaluate(async () => {
      let parentBlocked = false, networkBlocked = false;
      try { void parent.document.cookie; } catch { parentBlocked = true; }
      try { await fetch('https://example.com/private'); } catch { networkBlocked = true; }
      return { parentBlocked, networkBlocked, sessionEmpty: sessionStorage.length === 0, storage: localStorage.getItem('tasks') };
    });
    assert.deepEqual(isolation, { parentBlocked: true, networkBlocked: true, sessionEmpty: true, storage: saved.tasks });
  } finally { await browser.close(); }
});
