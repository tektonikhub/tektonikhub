import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { generationStream, GENERATION_HEARTBEAT_MS, readGenerationStream, type GenerationProgress, MAX_GENERATION_EVENT_BYTES } from '../lib/studio/generation-stream';
import { STUDIO_GENERATION_TIMEOUT } from '../lib/studio/generation';
import { llm } from '../lib/studio/llm';
import { htmlApplication } from './next-studio-html-fixture';
import { createRequire } from 'node:module';
import type { DashboardKit } from '../lib/studio/types';
const require = createRequire(import.meta.url);
const kit: DashboardKit = require('../lib/studio/runtime/dashboard-kit.js');
const config = kit.createConfig('ventas');
const encode = (events: unknown[]) => new TextEncoder().encode(events.map(event => JSON.stringify(event)).join('\n') + '\n');
const response = (events: unknown[]) => new Response(encode(events), { headers: { 'Content-Type': 'application/x-ndjson' } });

test('generation budget fits the durable lease and the hosting function duration', () => {
  const route = readFileSync(join('app', 'api', 'studio', 'generate', 'route.ts'), 'utf8');
  const migration = readFileSync(join('migrations', '20261107091504_studio-azure-generation-budget.sql'), 'utf8');
  const duration = Number(route.match(/maxDuration = (\d+)/)?.[1]);
  const lease = Number(migration.match(/interval '(\d+) seconds'/)?.[1]);
  assert.equal(STUDIO_GENERATION_TIMEOUT, 240_000);
  assert.ok(STUDIO_GENERATION_TIMEOUT < duration * 1000);
  assert.ok(STUDIO_GENERATION_TIMEOUT < lease * 1000);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /config\.calls >= 12/);
  assert.match(migration, /tk_can_access\(p_org\)/);
  assert.match(migration, /REVOKE ALL.*FROM PUBLIC, anon, authenticated/);
});

test('generation streaming emits phases before the result and heartbeat while Azure is pending', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const stream = generationStream(async progress => {
    progress('expand');
    await pending;
    progress('compose');
    return { config };
  }, new AbortController().signal, () => ({ status: 503, error: 'Failed' }));
  assert.match(stream.headers.get('cache-control') || '', /no-transform/);
  const reader = stream.body!.getReader();
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).stage, 'expand');
  t.mock.timers.tick(GENERATION_HEARTBEAT_MS);
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type, 'heartbeat');
  finish();
  const events: unknown[] = [];
  while (true) { const value = await reader.read(); if (value.done) break; events.push(JSON.parse(new TextDecoder().decode(value.value))); }
  assert.deepEqual(events.map(event => (event as {type: string}).type), ['progress', 'result']);
});

test('generation parser handles split UTF-8 and long operations, without returning partial configurations', async () => {
  const events = [
    { type: 'progress', stage: 'expand', elapsedMs: 0 },
    { type: 'progress', stage: 'compose', elapsedMs: 6000 },
    { type: 'heartbeat', elapsedMs: 65_000 },
    { type: 'progress', stage: 'validate', elapsedMs: 80_000 },
    { type: 'result', result: { title: 'Adopción de IA', config } },
  ];
  const bytes = encode(events);
  const chunks = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7)); controller.close(); } });
  const progress: GenerationProgress[] = [];
  const result = await readGenerationStream(new Response(chunks), undefined, value => progress.push(value));
  assert.deepEqual(result, events[4].result);
  assert.deepEqual(progress, [{ stage: 'expand', elapsedMs: 0 }, { stage: 'compose', elapsedMs: 6000 }, { stage: 'compose', elapsedMs: 65_000 }, { stage: 'validate', elapsedMs: 80_000 }]);
  await assert.rejects(readGenerationStream(response(events.slice(0, -1))), /incompleta/);
});

test('generation parser rejects malformed, oversized, duplicate terminal and unsafe progress events', async () => {
  for (const events of [
    [{ type: 'progress', stage: 'unknown', elapsedMs: 0 }],
    [{ type: 'heartbeat', elapsedMs: -1 }],
    [{ type: 'heartbeat', elapsedMs: '65' }],
    [{ type: 'result' }],
    [{ type: 'result', result: 'x'.repeat(MAX_GENERATION_EVENT_BYTES + 1) }],
    [{ type: 'result', result: {} }, { type: 'result', result: {} }],
    [{ type: 'result', result: {} }, { type: 'progress', stage: 'validate', elapsedMs: 0 }],
    [{ type: 'error', error: 'secret', status: 200 }],
    [{ type: 'result', result: 'x'.repeat(1_400_001) }],
  ]) await assert.rejects(readGenerationStream(response(events)), /incompleta/);
  await assert.rejects(readGenerationStream(new Response(new Uint8Array([0xff]))));
  await assert.rejects(readGenerationStream(new Response('not JSON\n')), /incompleta/);
});

test('timeout and upstream failure are terminal errors, never partial results or automatic retries', async () => {
  for (const status of [429, 502, 504]) {
    const stream = generationStream(async progress => { progress('compose'); throw new Error('private-upstream-data'); }, new AbortController().signal, () => ({ status, error: 'Azure agotó el plazo de generación.' }));
    await assert.rejects(readGenerationStream(stream), error => error instanceof Error && error.message === 'Azure agotó el plazo de generación.' && (error as { status?: number }).status === status);
  }
});

test('cancelling a streamed response reaches the runner and runs its lease cleanup', async () => {
  let cleaned = false, runnerSignal!: AbortSignal;
  let finishCleanup!: () => void;
  const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
  const stream = generationStream(async (progress, signal) => {
    runnerSignal = signal;
    progress('compose');
    try { await new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); }
    finally { cleaned = true; finishCleanup(); }
  }, new AbortController().signal, () => ({ status: 503, error: 'Failed' }));
  const reader = stream.body!.getReader();
  await reader.read();
  await reader.cancel();
  await cleanup;
  assert.equal(runnerSignal.aborted, true);
  assert.equal(cleaned, true);
});

test('browser cancellation during stream consumption stays an AbortError', async () => {
  const abort = new AbortController();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encode([{ type: 'progress', stage: 'expand', elapsedMs: 0 }])); } });
  const pending = readGenerationStream(new Response(body), abort.signal, () => abort.abort());
  await assert.rejects(pending, { name: 'AbortError' });
});

test('HTML near the UTF-8 bound supports JSON-escaped streaming and iteration requests', async () => {
  const application = { ...htmlApplication, html: htmlApplication.html.replace('</body>', `<pre hidden>${'"\\\n'.repeat(60_000)}</pre></body>`) };
  const payload = { application, provider: 'azure-openai', model: 'test-model' };
  assert.ok(new TextEncoder().encode(application.html).length < 200_000);
  assert.ok(encode([{ type: 'result', result: payload }]).length > 250_000);
  assert.deepEqual(await readGenerationStream(response([{ type: 'result', result: payload }])), payload);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, options) => {
      if (String(input) === '/api/session') return Response.json({ csrf: 'a'.repeat(64) });
      assert.ok(new TextEncoder().encode(String(options!.body)).length > 250_000);
      assert.equal(JSON.parse(String(options!.body)).previous.html, application.html);
      return response([{ type: 'result', result: payload }]);
    };
    const result = await llm.generate('org', 'Cambia el color sin perder los viajes', application, kit, new AbortController().signal);
    assert.equal(result.application.html, application.html);
  } finally { globalThis.fetch = original; }
  const azure = readFileSync(join('lib', 'server', 'azure.ts'), 'utf8');
  assert.match(azure, /path === '\/api\/studio\/generate' \? 1_300_000/);
});

test('Azure client consumes real stage events and validates final configuration without reissuing failures', async () => {
  const original = globalThis.fetch, progress: GenerationProgress[] = [];
  let calls = 0;
  try {
    globalThis.fetch = async (input, options) => {
      if (String(input) === '/api/session') return Response.json({ csrf: 'a'.repeat(64) });
      calls++;
      assert.equal((options!.headers as Record<string, string>).Accept, 'application/x-ndjson');
      return response([{ type: 'progress', stage: 'compose', elapsedMs: 65_000 }, { type: 'result', result: { application: htmlApplication, provider: 'azure-openai', model: 'test-model' } }]);
    };
    const result = await llm.generate('org', 'ventas', null, kit, new AbortController().signal, false, value => progress.push(value));
    assert.deepEqual(result.application, htmlApplication);
    assert.deepEqual(progress, [{ stage: 'compose', elapsedMs: 65_000 }]);
    globalThis.fetch = async () => { calls++; return response([{ type: 'error', status: 504, error: 'Azure agotó el plazo de generación.' }]); };
    await assert.rejects(llm.generate('org', 'ventas', null, kit, new AbortController().signal), /agotó/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
