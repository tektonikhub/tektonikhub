import { z } from 'zod';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}
export async function requestJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = globalThis.fetch): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetcher(url, { ...init, headers, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) });
  } catch {
    throw new ApiError(0, 'No se confirmó la comunicación. Consulta el registro antes de repetir el cambio.');
  }
  let raw: unknown;
  try { raw = await response.json(); }
  catch { throw new ApiError(response.status || 502, 'El servidor no devolvió una respuesta válida.'); }
  if (!response.ok) {
    const error = z.object({ error: z.string(), code: z.string().optional() }).safeParse(raw);
    throw new ApiError(response.status, error.success ? error.data.error : 'No se confirmó la operación.', error.success ? error.data.code : undefined);
  }
  return raw;
}
export function announceAuthChange(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('tektonik-session');
  channel.postMessage({ type: 'auth_changed' });
  channel.close();
}
