import 'server-only';
import { createAdminClient } from '@insforge/sdk';
import { createServerClient } from '@insforge/sdk/ssr';
import { cookies } from 'next/headers';
import { insforgeOptions } from '@/lib/auth/config';
import { HttpError } from './http';

export async function userClient() {
  return createServerClient({ ...insforgeOptions(), cookies: await cookies() });
}
export function identityAdminClient() {
  const apiKey = process.env.INSFORGE_API_KEY;
  if (!apiKey) throw new HttpError(503, 'El servicio de cuentas no está configurado.');
  return createAdminClient({ baseUrl: insforgeOptions().baseUrl, apiKey });
}
