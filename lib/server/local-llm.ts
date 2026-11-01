import 'server-only';
import { limitedJSONText, localTarget, LocalLLMError } from './local-llm-policy';
export async function forwardLocalLLM(request: Request, path: string): Promise<Response> {
  try {
    const target = localTarget(request, path, process.env);
    const headers = new Headers({ 'Content-Type': 'application/json', Origin: target.origin });
    let body: string | undefined;
    if (request.method === 'POST') { body = await limitedJSONText(request.body); headers.set('X-BLK-CSRF', request.headers.get('x-blk-csrf')!); }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(65_000)]);
    const upstream = await fetch(target, { method: request.method, headers, body, signal, cache: 'no-store', redirect: 'error' });
    if (!upstream.headers.get('content-type')?.startsWith('application/json')) { await upstream.body?.cancel(); throw new LocalLLMError('Respuesta del servicio local no válida.', 502); }
    let responseBody: string;
    try { responseBody = await limitedJSONText(upstream.body); } catch { throw new LocalLLMError('El servicio local no devolvió JSON válido dentro del límite.', 502); }
    return new Response(responseBody, { status: upstream.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const status = error instanceof LocalLLMError ? error.status : request.signal.aborted || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) ? 504 : 502;
    const message = error instanceof LocalLLMError ? error.message : status === 504 ? 'Petición cancelada o tiempo de espera agotado.' : 'No se pudo conectar con el servicio local. Inicia npm run dev:llm y verifica el puerto configurado.';
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
