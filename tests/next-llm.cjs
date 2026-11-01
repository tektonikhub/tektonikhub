'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createLocalServer } = require('../server/llm.cjs');
const kit = require('../lib/studio/runtime/dashboard-kit.js');
const root = path.resolve(__dirname, '..');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const fakeKey = 'next-integration-not-a-real-key';
let mode = 'valid', cancelled = false, calls = 0;
const completion = value => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
const backend = createLocalServer({ azureFetch: async (_url, options) => {
  calls += 1;
  assert.equal(options.headers['api-key'], fakeKey);
  if (mode === 'block') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { cancelled = true; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true }));
  const input = JSON.parse(options.body).messages.at(-1).content;
  if (input.includes('Return {"ok":true}')) return completion({ ok: true });
  const { request, previous } = JSON.parse(input);
  return completion(mode === 'invalid' ? { script: 'alert(1)' } : kit.createConfig(request, previous));
} });
async function availablePort() { const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port; }
function stopOwnedTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const script = `function Stop-Owned([int]$processId) { Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" | ForEach-Object { Stop-Owned $_.ProcessId }; Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }; Stop-Owned ${child.pid}`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  } else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
}
async function main() {
  let next;
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  try {
    const port = await availablePort();
    const base = `http://127.0.0.1:${port}`;
    next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env: { ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', BLK_ENABLE_LOCAL_LLM: 'true', BLK_LOCAL_LLM_PORT: String(backend.address().port) }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    const append = value => { logs = (logs + value.toString()).slice(-10000); };
    next.stdout.on('data', append); next.stderr.on('data', append);
    let session;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (next.exitCode !== null) throw new Error(`Next no pudo iniciar: ${logs}`);
      try { const response = await fetch(base + '/api/session', { signal: AbortSignal.timeout(2000) }); if (response.ok) { session = await response.json(); break; } if (response.status === 403) { logs += await response.text(); break; } } catch {}
      await wait(500);
    }
    assert.ok(session?.localOnly && /^[a-f0-9]{64}$/.test(session.csrf), `Puente no disponible: ${logs}`);
    const get = endpoint => fetch(base + endpoint);
    const post = (endpoint, body, options = {}) => fetch(base + endpoint, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-BLK-CSRF': session.csrf }, body: JSON.stringify(body), ...options });
    let response = await get('/api/llm/settings?orgId=%234029');
    assert.equal(response.status, 200); assert.equal((await response.json()).configured, false);
    response = await post('/api/llm/settings', { orgId: '#4029', endpoint: 'https://integration-test.openai.azure.com', deployment: 'test-dashboard', apiVersion: '2024-10-21', apiKey: fakeKey });
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(fakeKey));
    response = await post('/api/llm/test', { orgId: '#4029' });
    assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
    console.log('PASS: Next development bridge, local CSRF, credentials remain server-only, mocked Azure JSON test');
    response = await post('/api/studio/generate', { orgId: '#4029', prompt: 'Crea un dashboard de ventas con tabla y gráfico' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.provider, 'azure-openai'); assert.equal(result.config.template, 'sales');
    assert.ok(result.config.components.length >= 4); assert.ok(!JSON.stringify(result).includes(fakeKey));
    response = await post('/api/studio/generate', { orgId: '#4029', prompt: 'Ponlo en modo oscuro', previous: result.config });
    assert.equal(response.status, 200); assert.equal((await response.json()).config.theme.dark, true);
    mode = 'invalid';
    response = await post('/api/studio/generate', { orgId: '#4029', prompt: 'Dashboard de ventas' });
    assert.equal(response.status, 422); assert.ok((await response.json()).error.includes('catálogo'));
    console.log('PASS: validated dashboard, prior-config iteration and rejection of executable model output');
    response = await post('/api/llm/test', { orgId: '#4029' }, { headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json', 'X-BLK-CSRF': session.csrf } });
    assert.equal(response.status, 403);
    response = await post('/api/llm/test', { orgId: '#4029' }, { headers: { Origin: base, 'Content-Type': 'application/json', 'X-BLK-CSRF': '0'.repeat(64) } });
    assert.equal(response.status, 403);
    response = await post('/api/llm/test', { orgId: '#4029', padding: 'x'.repeat(250000) });
    assert.equal(response.status, 413);
    response = await post('/api/llm/unknown', { orgId: '#4029' });
    assert.equal(response.status, 404);
    response = await post('/api/llm/test', {}, { body: new Uint8Array([0x22, 0xff, 0x22]) });
    assert.equal(response.status, 400);
    response = await post('/api/llm/test', {}, { body: 'not-json' });
    assert.equal(response.status, 400);
    console.log('PASS: origin, CSRF, streamed size limits and no arbitrary proxy route');
    mode = 'block';
    const abort = new AbortController();
    const blocked = post('/api/studio/generate', { orgId: '#4029', prompt: 'Dashboard de ventas' }, { signal: abort.signal });
    const before = calls;
    for (let attempt = 0; attempt < 30 && calls === before; attempt++) await wait(100);
    assert.ok(calls > before, 'La solicitud debe alcanzar el mock antes de cancelar');
    abort.abort(); await assert.rejects(() => blocked);
    for (let attempt = 0; attempt < 50 && !cancelled; attempt++) await wait(100);
    assert.equal(cancelled, true, 'Cancelar en Next debe abortar Azure upstream');
    mode = 'valid';
    response = await post('/api/llm/clear', { orgId: '#4029' });
    assert.equal(response.status, 200); assert.equal((await response.json()).configured, false);
    response = await post('/api/llm/test', { orgId: '#4029' }); assert.equal(response.status, 409);
    console.log('PASS: disconnect cancellation reaches Azure; explicit credential removal and no silent demo fallback');
  } finally {
    stopOwnedTree(next);
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
