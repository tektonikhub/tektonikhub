import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { brandDefaults } from '../lib/data/workspace';
import nextConfig from '../next.config';
import { applyBrand, BRAND_MAP, validBrandValue } from '../lib/config/branding';
import { limitedJSONText, localTarget, LocalLLMError, type LocalLLMEnvironment } from '../lib/server/local-llm-policy';

const enabled: LocalLLMEnvironment = { NODE_ENV: 'development', BLK_ENABLE_LOCAL_LLM: 'true' };
const localRequest = (path: string, options: RequestInit = {}) => new Request(`http://127.0.0.1:3000${path}`, { ...options, headers: { host: '127.0.0.1:3000', ...options.headers } });
const post = { method: 'POST', headers: { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json', 'x-blk-csrf': 'a'.repeat(64) }, body: '{}' };
const denies = (operation: () => unknown, status: number) => assert.throws(operation, (error: unknown) => error instanceof LocalLLMError && error.status === status);

test('Next has no HTML aliases, archived rewrites or deprecated UI links', () => {
  assert.equal('redirects' in nextConfig, false);
  assert.equal('rewrites' in nextConfig, false);
  for (const file of ['landing.tsx', 'app-shell.tsx'].map(name => join('components', 'layout', name))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /(?:href|src)=["'][^"']*(?:\/legacy\/|\/Old\/|\.html)/i);
  }
  const script = readFileSync(join('scripts', 'sync-public.cjs'), 'utf8');
  assert.doesNotMatch(script, /copyFileSync[^\n]*(?:legacy|Old|\.html)/);
  assert.match(script, /'lib', 'studio', 'runtime'/);
});
test('Public preparation needs no dataset and removes stale public demo data', t => {
  const root = mkdtempSync(join(tmpdir(), 'blk-public-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, 'scripts');
  const runtime = join(root, 'lib', 'studio', 'runtime');
  const stale = join(root, 'public', 'legacy');
  for (const directory of [scripts, runtime, stale]) mkdirSync(directory, { recursive: true });
  copyFileSync(join('scripts', 'sync-public.cjs'), join(scripts, 'sync-public.cjs'));
  writeFileSync(join(root, 'public', 'data.json'), '{"demo":true}');
  writeFileSync(join(stale, 'index.html'), 'stale published prototype');
  const engines = ['studio-engine.js', 'dashboard-kit.js'];
  for (const name of engines) writeFileSync(join(runtime, name), `current runtime: ${name}`);
  execFileSync(process.execPath, [join(scripts, 'sync-public.cjs')], { cwd: root, stdio: 'pipe' });
  assert.equal(existsSync(stale), false);
  assert.deepEqual(readdirSync(join(root, 'public')).sort(), ['engines']);
  assert.deepEqual(readdirSync(join(root, 'public', 'engines')).sort(), engines.sort());
  assert.equal(existsSync(join(root, 'public', 'data.json')), false);
  for (const name of engines) assert.equal(readFileSync(join(root, 'public', 'engines', name), 'utf8'), `current runtime: ${name}`);
});
test('Platform headers disable sniffing and sensitive browser features', async () => {
  const rules = await nextConfig.headers?.();
  const headers = rules?.[0].headers;
  assert.equal(headers?.find(header => header.key === 'X-Content-Type-Options')?.value, 'nosniff');
  assert.ok(headers?.find(header => header.key === 'Permissions-Policy')?.value.includes('camera=()'));
});
test('The homepage has no obsolete dataset dependency or fabricated business counts', () => {
  const page = readFileSync(join('app', 'page.tsx'), 'utf8');
  const landing = readFileSync(join('components', 'layout', 'landing.tsx'), 'utf8');
  assert.doesNotMatch(page, /data\.json|counts|seed/);
  assert.doesNotMatch(landing, /counts\.|fixture|local demo|demo local|No connected backend|Sin backend conectado|role=superadmin/i);
  assert.match(landing, /href="\/login"/);
  assert.doesNotMatch(landing, /InsForge/i);
  const shell = readFileSync(join('components', 'layout', 'app-shell.tsx'), 'utf8');
  assert.doesNotMatch(shell, /InsForge|Tu talento\. Un solo hub\.|Crear · revisar · compartir/i);
  for (const file of ['app/layout.tsx', 'components/features/shared.tsx', 'components/features/super-admin.tsx', 'components/studio/llm-settings.tsx']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /InsForge/i);
  }
});
test('Tektonik hub branding covers page metadata without changing persistence keys', () => {
  const layout = readFileSync(join('app', 'layout.tsx'), 'utf8');
  assert.match(layout, /applicationName: 'Tektonik hub'/);
  assert.match(layout, /siteName: 'Tektonik hub'/);
  assert.doesNotMatch(layout, /\bBLK\b/i);
  assert.match(readFileSync(join('components', 'features', 'brand.tsx'), 'utf8'), /key === 'blk' \? 'Tektonik hub'/);
});
test('Brand tokens apply atomically with readable accent foreground', () => {
  const values = new Map<string, string>();
  applyBrand(brandDefaults, { setProperty: (key, value) => { values.set(key, value ?? ''); } });
  assert.equal(values.get('--accent'), '#FEFF44');
  assert.equal(values.get('--accent-on'), '#111111');
  applyBrand({ ...brandDefaults, accent: '#111111' }, { setProperty: (key, value) => { values.set(key, value ?? ''); } });
  assert.equal(values.get('--accent-on'), '#FFFFFF');
  assert.equal(values.size, Object.keys(BRAND_MAP).length + 1);
});
test('Brand rejects CSS injection before applying any property', () => {
  let mutations = 0;
  assert.throws(() => applyBrand({ ...brandDefaults, bg: '#111111; background:url(https://example.invalid)' }, { setProperty: () => { mutations += 1; } }));
  assert.equal(mutations, 0);
  assert.equal(validBrandValue('displayFont', 'url(https://example.invalid)'), false);
  assert.equal(validBrandValue('rCard', 'expression(alert(1))'), false);
});
test('Local LLM is disabled by default and cannot run in production', () => {
  denies(() => localTarget(localRequest('/api/session'), '/api/session', {}), 503);
  denies(() => localTarget(localRequest('/api/session'), '/api/session', { ...enabled, NODE_ENV: 'production' }), 503);
});
test('Bridge only targets a fixed loopback host and validates organization queries', () => {
  const target = localTarget(localRequest('/api/llm/settings?orgId=%234029&url=https://example.invalid'), '/api/llm/settings', enabled);
  assert.equal(target.origin, 'http://127.0.0.1:8027');
  assert.equal(target.searchParams.get('orgId'), '#4029');
  assert.equal(target.searchParams.size, 1);
  denies(() => localTarget(localRequest('/api/llm/settings'), '/api/llm/settings', enabled), 400);
  denies(() => localTarget(localRequest('/api/session'), '/api/session', { ...enabled, BLK_LOCAL_LLM_PORT: '3000' }), 503);
  denies(() => localTarget(localRequest('/api/session'), '/api/session', { ...enabled, BLK_LOCAL_LLM_PORT: 'https://example.invalid' }), 503);
});
test('Bridge rejects remote hosts, host spoofing and foreign origins', () => {
  denies(() => localTarget(new Request('http://example.invalid:3000/api/session', { headers: { host: 'example.invalid:3000' } }), '/api/session', enabled), 403);
  denies(() => localTarget(localRequest('/api/session', { headers: { host: 'example.invalid' } }), '/api/session', enabled), 403);
  denies(() => localTarget(localRequest('/api/session', { headers: { origin: 'https://example.invalid' } }), '/api/session', enabled), 403);
  denies(() => localTarget(localRequest('/api/session', { headers: { 'sec-fetch-site': 'cross-site' } }), '/api/session', enabled), 403);
});
test('Next loopback URL normalization preserves browser-origin validation', () => {
  const request = new Request('http://localhost:3000/api/studio/generate', { ...post, headers: { ...post.headers, host: '127.0.0.1:3000' } });
  assert.equal(localTarget(request, '/api/studio/generate', enabled).origin, 'http://127.0.0.1:8027');
  denies(() => localTarget(new Request(request.url, { ...post, headers: { ...post.headers, host: '127.0.0.1:3001' } }), '/api/studio/generate', enabled), 403);
});
test('POST requires matching origin, JSON, bounded body and CSRF; no wildcard proxy', () => {
  assert.equal(localTarget(localRequest('/api/studio/generate', post), '/api/studio/generate', enabled).pathname, '/api/studio/generate');
  denies(() => localTarget(localRequest('/api/llm/test', { ...post, headers: { ...post.headers, origin: 'http://localhost:3000' } }), '/api/llm/test', enabled), 403);
  denies(() => localTarget(localRequest('/api/llm/test', { ...post, headers: { origin: post.headers.origin, 'content-type': 'application/json' } }), '/api/llm/test', enabled), 403);
  denies(() => localTarget(localRequest('/api/llm/test', { ...post, headers: { ...post.headers, 'content-type': 'text/plain' } }), '/api/llm/test', enabled), 415);
  denies(() => localTarget(localRequest('/api/llm/test', { ...post, headers: { ...post.headers, 'content-length': '250001' } }), '/api/llm/test', enabled), 413);
  denies(() => localTarget(localRequest('/api/unknown', post), '/api/unknown', enabled), 404);
  denies(() => localTarget(localRequest('/api/llm/clear'), '/api/llm/clear', enabled), 404);
});
test('Body reader limits actual streamed bytes, validates JSON and handles Unicode', async () => {
  assert.equal(await limitedJSONText(new Response('{"name":"España"}').body), '{"name":"España"}');
  await assert.rejects(() => limitedJSONText(new Response('not-json').body), (error: unknown) => error instanceof LocalLLMError && error.status === 400);
  await assert.rejects(() => limitedJSONText(new Response('"éééé"').body, 8), (error: unknown) => error instanceof LocalLLMError && error.status === 413);
  await assert.rejects(() => limitedJSONText(null), (error: unknown) => error instanceof LocalLLMError && error.status === 400);
  await assert.rejects(() => limitedJSONText(new Response(new Uint8Array([0x22, 0xff, 0x22])).body), (error: unknown) => error instanceof LocalLLMError && error.status === 400);
});
