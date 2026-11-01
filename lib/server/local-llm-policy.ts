export const LOCAL_LLM_MAX_BODY = 250_000;
export class LocalLLMError extends Error { constructor(message: string, public readonly status: number) { super(message); } }
export type LocalLLMEnvironment = { NODE_ENV?: string; BLK_ENABLE_LOCAL_LLM?: string; BLK_LOCAL_LLM_PORT?: string };
export function localTarget(request: Request, path: string, env: LocalLLMEnvironment): URL {
  if (env.NODE_ENV !== 'development' || env.BLK_ENABLE_LOCAL_LLM !== 'true') throw new LocalLLMError('LLM local desactivado. Solo está disponible con activación explícita en desarrollo.', 503);
  const url = new URL(request.url);
  const host = request.headers.get('host');
  // Next normalizes Request.url to localhost even when the browser uses 127.0.0.1.
  const localHosts = ['127.0.0.1', 'localhost'];
  if (url.protocol !== 'http:' || !localHosts.includes(url.hostname) || !localHosts.some(name => host === `${name}${url.port ? `:${url.port}` : ''}`)) throw new LocalLLMError('Este puente solo admite el host local de desarrollo.', 403);
  const browserOrigin = `http://${host}`;
  const origin = request.headers.get('origin');
  if ((origin && origin !== browserOrigin) || (request.method === 'POST' && origin !== browserOrigin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new LocalLLMError('Origen no permitido.', 403);
  const allowed = request.method === 'GET' ? ['/api/session', '/api/llm/settings'] : request.method === 'POST' ? ['/api/llm/settings', '/api/llm/clear', '/api/llm/test', '/api/studio/generate'] : [];
  if (!allowed.includes(path)) throw new LocalLLMError('Ruta o método no disponibles.', 404);
  if (request.method === 'POST') {
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new LocalLLMError('Se requiere application/json.', 415);
    if (!/^[a-f0-9]{64}$/.test(request.headers.get('x-blk-csrf') ?? '')) throw new LocalLLMError('Recarga la página antes de continuar.', 403);
    const length = request.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > LOCAL_LLM_MAX_BODY)) throw new LocalLLMError('Solicitud demasiado grande.', 413);
  }
  const port = Number(env.BLK_LOCAL_LLM_PORT ?? '8027');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === Number(url.port || 80)) throw new LocalLLMError('El puerto del servidor LLM local no es válido.', 503);
  const target = new URL(path, `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && path === '/api/llm/settings') {
    const orgId = url.searchParams.get('orgId');
    if (!orgId || !/^[\w#-]{1,80}$/.test(orgId)) throw new LocalLLMError('Organización inválida.', 400);
    target.searchParams.set('orgId', orgId);
  }
  return target;
}
export async function limitedJSONText(body: ReadableStream<Uint8Array> | null, maximum = LOCAL_LLM_MAX_BODY): Promise<string> {
  if (!body) throw new LocalLLMError('Se requiere un cuerpo JSON.', 400);
  const reader = body.getReader();
  const parts: Uint8Array[] = []; let length = 0;
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > maximum) throw new LocalLLMError('El contenido supera el límite permitido.', 413); parts.push(chunk.value); } }
  finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    JSON.parse(text);
    return text;
  } catch { throw new LocalLLMError('JSON inválido.', 400); }
}
