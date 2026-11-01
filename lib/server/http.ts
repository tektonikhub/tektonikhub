import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { appUrl } from '@/lib/auth/config';
import { trustedOrigin } from '@/lib/auth/policy';
import { limitedJSONText, LocalLLMError } from './local-llm-policy';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}
export function sameOrigin(request: Request): void {
  if (!trustedOrigin(request.headers.get('origin'), appUrl(), process.env.NODE_ENV !== 'production')) {
    throw new HttpError(403, 'Origen de solicitud no permitido.');
  }
}
export async function readJson(request: Request, maxBytes = 500000): Promise<unknown> {
  try { return JSON.parse(await limitedJSONText(request.body, maxBytes)); }
  catch (error) {
    if (error instanceof LocalLLMError) throw new HttpError(error.status, error.message);
    throw error;
  }
}
export function databaseError(error: { code?: string; message: string }): never {
  if (error.code === '42501') throw new HttpError(403, error.message);
  if (['40001', '40P01'].includes(error.code || '')) throw new HttpError(409, 'El registro cambió o hay otra operación en curso. Recarga y vuelve a intentarlo.');
  if (error.code === '23505') throw new HttpError(409, 'El usuario, correo, nombre o dominio ya está registrado.');
  if (error.code === '23503') throw new HttpError(409, 'El registro tiene relaciones vinculadas o la referencia no existe.');
  if (error.code === 'P0001') throw new HttpError(400, error.message);
  if (['23502', '23514', '22P02', '22023'].includes(error.code || '')) throw new HttpError(400, 'Los campos no cumplen las reglas de la base de datos.');
  console.error('InsForge database request failed', { code: error.code });
  throw new HttpError(503, 'La base de datos no confirmó la operación. Vuelve a intentarlo.');
}
export function jsonResponse(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) return jsonResponse({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  if (error instanceof z.ZodError) return jsonResponse({ error: error.issues[0]?.message || 'Campos no válidos.' }, 400);
  console.error('Application request failed', { name: error instanceof Error ? error.name : 'UnknownError' });
  return jsonResponse({ error: 'No se pudo completar la solicitud. Vuelve a intentarlo.' }, 503);
}
