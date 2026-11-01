import 'server-only';
import { createHmac } from 'node:crypto';
import { identityAdminClient } from './insforge';
import { databaseError, HttpError } from './http';

export async function authThrottle(request: Request, identifier: string, operation: 'login' | 'recover'): Promise<void> {
  const secret = process.env.INSFORGE_API_KEY;
  if (!secret) throw new HttpError(503, 'El servicio de cuentas no está configurado.');
  const admin = identityAdminClient();
  const ip = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() : 'local';
  const keys = [
    { value: `${operation}:identifier:${identifier}`, limit: operation === 'login' ? 10 : 3 },
    { value: `${operation}:ip:${ip || 'unavailable'}`, limit: operation === 'login' ? 60 : 30 },
  ];
  const results = await Promise.all(keys.map(({ value, limit }) => admin.database.rpc('tk_auth_throttle', {
    p_key: createHmac('sha256', secret).update(value).digest('hex'), p_limit: limit,
  })));
  for (const result of results) {
    if (result.error) databaseError(result.error);
    if (result.data !== true) throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.');
  }
}
export async function resolveLoginEmail(identifier: string): Promise<string> {
  const admin = identityAdminClient();
  const { data, error } = await admin.database.from('users').select('email')
    .eq(identifier.includes('@') ? 'email_key' : 'username_key', identifier).limit(1).maybeSingle();
  if (error) databaseError(error);
  if (data && typeof data.email === 'string') return data.email;
  const secret = process.env.INSFORGE_API_KEY;
  if (!secret) throw new HttpError(503, 'El servicio de cuentas no está configurado.');
  return `unassigned-${createHmac('sha256', secret).update(identifier).digest('hex')}@invalid.example`;
}
export async function loginSetupRequired(): Promise<boolean> {
  const { data, error } = await identityAdminClient().database.from('users').select('id').limit(1).maybeSingle();
  if (error) databaseError(error);
  return data === null;
}
