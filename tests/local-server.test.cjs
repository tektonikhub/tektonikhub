'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createLocalServer, normalizeSettings } = require('../server/llm.cjs');
const fakeKey = 'test-only-not-a-real-azure-key';
const fields = { endpoint: 'https://test-resource.openai.azure.com', deployment: 'test-deployment', apiVersion: '2024-10-21', apiKey: fakeKey };
async function harness(t, azureFetch) {
  const server = createLocalServer({ azureFetch });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { csrf } = await (await fetch(base + '/api/session')).json();
  const post = (url, body, extra = {}) => fetch(base + url, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-BLK-CSRF': csrf, ...extra.headers }, body: JSON.stringify({ orgId: 'test-org', ...body }), ...(extra.signal ? { signal: extra.signal } : {}) });
  return { server, base, csrf, post };
}
const completion = (output, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: JSON.stringify(output) } }] }), { status: 200 });
test('Azure settings reject arbitrary endpoints, malformed identifiers and credentials', () => {
  assert.deepEqual(normalizeSettings(fields), fields);
  for (const endpoint of ['http://test-resource.openai.azure.com', 'https://localhost', 'https://127.0.0.1', 'https://evil.test', 'https://test-resource.openai.azure.com.evil.test', 'https://test-resource.openai.azure.com/path', 'https://test-resource.openai.azure.com/?key=x', 'https://user@test-resource.openai.azure.com', 'https://test-resource.openai.azure.com:8443']) assert.throws(() => normalizeSettings({ ...fields, endpoint }));
  assert.throws(() => normalizeSettings({ ...fields, deployment: '../secret' }));
  assert.throws(() => normalizeSettings({ ...fields, apiVersion: 'unsafe?x' }));
  assert.throws(() => normalizeSettings({ ...fields, apiKey: 'abc\n123456' }));
  assert.throws(() => normalizeSettings({ ...fields, apiKey: '' }));
  assert.equal(normalizeSettings({ ...fields, apiKey: '' }, fields).apiKey, fakeKey);
});
test('HTTP guards: host/origin/CSRF, JSON content, request limits and private paths', async t => {
  const { base, post } = await harness(t);
  const badHost = await new Promise((resolve, reject) => {
    const request = http.get(base + '/api/session', { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(base + '/api/session', { headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await post('/api/llm/settings', fields, { headers: { 'X-BLK-CSRF': 'invalid' } })).status, 403);
  assert.equal((await post('/api/llm/settings', fields, { headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await post('/api/llm/settings', fields, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await post('/api/llm/settings', { ...fields, padding: 'x'.repeat(250001) })).status, 413);
  assert.equal((await post('/api/llm/settings', { ...fields, orgId: '../another' })).status, 400);
  for (const file of ['/server/local.cjs', '/.insforge/config.json', '/.agents/skills/dashboard-builder/SKILL.md', '/package.json', '/node_modules/playwright/package.json', '/tests/local-server.test.cjs', '/assets/%2e%2e/server/local.cjs']) assert.equal((await fetch(base + file)).status, 404, file);
  for (const file of ['/', '/index.html', '/create-app.html', '/assets/js/llm-client.js', '/legacy/index.html', '/Old/index.html', '/engines/dashboard-kit.js']) {
    for (const method of ['GET', 'HEAD']) assert.equal((await fetch(base + file, { method })).status, 404, `${method} ${file}`);
  }
  const status = await fetch(base + '/api/llm/settings?orgId=test-org');
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal((await status.json()).configured, false);
});
test('settings are memory-only, redacted, per-org and removable', async t => {
  const { base, post } = await harness(t);
  const saved = await post('/api/llm/settings', fields);
  assert.equal(saved.status, 200);
  assert.doesNotMatch(await saved.text(), /test-only-not-a-real-azure-key|apiKey/);
  const status = await (await fetch(base + '/api/llm/settings?orgId=test-org')).json();
  assert.equal(status.configured, true);
  assert.equal(status.storage, 'server-memory');
  assert.equal((await (await fetch(base + '/api/llm/settings?orgId=other')).json()).configured, false);
  assert.equal((await post('/api/llm/settings', { ...fields, apiKey: '', deployment: 'updated' })).status, 200);
  assert.equal((await (await post('/api/llm/clear', {})).json()).configured, false);
  assert.equal((await post('/api/llm/test', {})).status, 409);
  const restarted = await harness(t);
  assert.equal((await (await fetch(restarted.base + '/api/llm/settings?orgId=test-org')).json()).configured, false);
});
test('real Azure request contract, builder context, previous config and response validation', async t => {
  const kit = require('../lib/studio/runtime/dashboard-kit.js');
  const original = kit.createConfig('dashboard de ventas');
  const changed = kit.createConfig('modo oscuro', original);
  const requests = [];
  const { post } = await harness(t, async (url, options) => { requests.push({ url, options }); return completion(requests.length === 1 ? { ok: true } : changed); });
  await post('/api/llm/settings', fields);
  assert.equal((await post('/api/llm/test', {})).status, 200);
  const response = await post('/api/studio/generate', { prompt: 'modo oscuro', previous: original });
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.deepEqual(answer.config, changed);
  assert.equal(answer.provider, 'azure-openai');
  assert.doesNotMatch(JSON.stringify(answer), /test-only-not-a-real-azure-key/);
  assert.equal(requests[1].url, fields.endpoint + '/openai/deployments/test-deployment/chat/completions?api-version=2024-10-21');
  assert.equal(requests[1].options.headers['api-key'], fakeKey);
  assert.equal(requests[1].options.redirect, 'error');
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.response_format.type, 'json_object');
  assert.match(body.messages[0].content, /dashboard|component/);
  assert.deepEqual(JSON.parse(body.messages[1].content).previous, original);
  assert.equal((await post('/api/studio/generate', { prompt: 'x', previous: { malicious: 'eval' } })).status, 400);
  assert.equal(requests.length, 2);
});
test('provider failures and invalid/truncated/model executable outputs do not leak details', async t => {
  let responseFactory = () => new Response('provider body contains ' + fakeKey, { status: 401 });
  const { post } = await harness(t, async () => responseFactory());
  await post('/api/llm/settings', fields);
  const rejected = await post('/api/llm/test', {});
  assert.equal(rejected.status, 502); assert.doesNotMatch(await rejected.text(), /test-only-not-a-real-azure-key|provider body/);
  responseFactory = () => completion({ ok: true }, 'length');
  assert.equal((await post('/api/llm/test', {})).status, 422);
  responseFactory = () => completion({ html: '<script>alert(1)</script>' });
  assert.equal((await post('/api/studio/generate', { prompt: 'dashboard' })).status, 422);
  responseFactory = () => new Response('not JSON');
  assert.equal((await post('/api/llm/test', {})).status, 502);
  responseFactory = () => completion({ ok: true });
  for (let i = 0; i < 8; i++) await post('/api/llm/test', {});
  assert.equal((await post('/api/llm/test', {})).status, 429);
});
test('oversized provider responses and overlong prompts are bounded without committing output', async t => {
  let calls = 0;
  const { post } = await harness(t, async () => { calls++; return new Response('x'.repeat(250001)); });
  await post('/api/llm/settings', fields);
  assert.equal((await post('/api/studio/generate', { prompt: 'x'.repeat(2001) })).status, 400);
  assert.equal(calls, 0);
  const oversized = await post('/api/llm/test', {});
  assert.equal(oversized.status, 502);
  assert.match(await oversized.text(), /demasiado grande/);
  assert.equal(calls, 1);
});
test('concurrency is bounded and disconnect cancels upstream Azure work', async t => {
  let entered, aborted;
  const started = new Promise(resolve => { entered = resolve; });
  const cancelled = new Promise(resolve => { aborted = resolve; });
  const { post } = await harness(t, async (_, { signal }) => { entered(); return new Promise((resolve, reject) => { signal.addEventListener('abort', () => { aborted(); reject(new DOMException('cancelled', 'AbortError')); }, { once: true }); }); });
  await post('/api/llm/settings', fields);
  const abort = new AbortController();
  const pending = post('/api/llm/test', {}, { signal: abort.signal }).catch(error => error);
  await started;
  assert.equal((await post('/api/llm/test', {})).status, 429);
  assert.equal((await post('/api/llm/settings', fields)).status, 409);
  abort.abort();
  assert.equal((await pending).name, 'AbortError');
  await Promise.race([cancelled, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream not cancelled')), 2000))]);
});
