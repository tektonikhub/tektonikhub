export type GenerationStage = 'expand' | 'compose' | 'repair' | 'validate';
export interface GenerationProgress { stage: GenerationStage; elapsedMs: number }
export const GENERATION_STREAM_TYPE = 'application/x-ndjson';
export const GENERATION_HEARTBEAT_MS = 15_000;

export class GenerationStreamError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export async function readGenerationStream(response: Response, signal?: AbortSignal, onProgress?: (progress: GenerationProgress) => void): Promise<unknown> {
  if (!response.body) throw new Error('El servicio no devolvió el resultado de generación.');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', bytes = 0, finished = false, result: unknown, stage: GenerationStage = 'expand';
  const fail = () => new Error('La respuesta de generación quedó incompleta o no es válida. La versión anterior se conserva.');
  const accept = (line: string) => {
    if (!line.trim()) return;
    if (finished || line.length > 250_000) throw fail();
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw fail(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
    const event = value as Record<string, unknown>;
    if (event.type === 'error') {
      if (!Number.isInteger(event.status) || Number(event.status) < 400 || Number(event.status) > 599 || typeof event.error !== 'string' || event.error.length > 2000) throw fail();
      throw new GenerationStreamError(event.error, Number(event.status));
    }
    if (event.type === 'result') { if (!Object.hasOwn(event, 'result')) throw fail(); finished = true; result = event.result; return; }
    if (event.type !== 'progress' && event.type !== 'heartbeat') throw fail();
    if (typeof event.elapsedMs !== 'number' || !Number.isSafeInteger(event.elapsedMs) || event.elapsedMs < 0 || event.elapsedMs > 360_000) throw fail();
    if (event.type === 'progress') {
      if (!['expand', 'compose', 'repair', 'validate'].includes(String(event.stage))) throw fail();
      stage = event.stage as GenerationStage;
    }
    onProgress?.({ stage, elapsedMs: event.elapsedMs });
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) { buffer += decoder.decode(); break; }
      bytes += value.byteLength;
      if (bytes > 300_000) throw fail();
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) { accept(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (buffer.length > 250_000) throw fail();
    }
    if (buffer) accept(buffer);
    if (!finished) throw fail();
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function generationStream(
  run: (progress: (stage: GenerationStage) => void, signal: AbortSignal) => Promise<unknown>,
  requestSignal: AbortSignal,
  describeError: (error: unknown) => { status: number; error: string },
): Response {
  const cancellation = new AbortController();
  const signal = AbortSignal.any([requestSignal, cancellation.signal]);
  const started = Date.now(), encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const elapsedMs = () => Date.now() - started;
      const send = (value: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + '\n')); };
      const close = () => { if (!closed) { closed = true; controller.close(); } };
      const abort = () => { clearInterval(heartbeat); close(); };
      signal.addEventListener('abort', abort, { once: true });
      const heartbeat = setInterval(() => send({ type: 'heartbeat', elapsedMs: elapsedMs() }), GENERATION_HEARTBEAT_MS);
      void (async () => {
        try {
          signal.throwIfAborted();
          const result = await run(stage => send({ type: 'progress', stage, elapsedMs: elapsedMs() }), signal);
          signal.throwIfAborted();
          send({ type: 'result', result });
        } catch (error) {
          if (!signal.aborted) send({ type: 'error', ...describeError(error) });
        } finally {
          clearInterval(heartbeat);
          signal.removeEventListener('abort', abort);
          close();
        }
      })();
    },
    cancel() { closed = true; cancellation.abort(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': GENERATION_STREAM_TYPE + '; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  } });
}
