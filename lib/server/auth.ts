import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getAccessTokenCookieName } from '@insforge/sdk/ssr';
import { z } from 'zod';
import type { Role } from '@/lib/domain/types';
import { validateSession } from '@/lib/data/validation';
import { parseWorkspace } from '@/lib/data/workspace';
import { destinations, rolesForPath } from '@/lib/auth/policy';
import { userClient } from './insforge';
import { databaseError, HttpError } from './http';

export const authenticatedContext = cache(async () => {
  if ((await headers()).get('x-tektonik-auth-unavailable') === '1') throw new HttpError(503, 'El servicio de autenticación no está disponible. Vuelve a intentarlo.');
  if (!(await cookies()).get(getAccessTokenCookieName())) throw new HttpError(401, 'Inicia sesión para continuar.');
  const client = await userClient();
  const { data, error } = await client.auth.getCurrentUser();
  if (error || !data.user) {
    if (error && (error.statusCode === 0 || error.statusCode >= 500 || error.statusCode === 429)) {
      console.error('InsForge account verification failed', { code: error.error, status: error.statusCode });
      throw new HttpError(503, 'El servicio de autenticación no está disponible.');
    }
    throw new HttpError(401, 'La sesión caducó. Vuelve a iniciar sesión.');
  }
  if (!data.user.emailVerified) throw new HttpError(403, 'La cuenta todavía no está activada.', 'ACCOUNT_BLOCKED');
  const result = await client.database.rpc('tk_identity');
  if (result.error) databaseError(result.error);
  if (!result.data) throw new HttpError(403, 'La cuenta está desactivada o no tiene una empresa y un rol autorizados.', 'ACCOUNT_BLOCKED');
  return { client, session: validateSession(result.data), authUserId: data.user.id };
});
export async function workspaceForUser() {
  const { client } = await authenticatedContext();
  const { data, error } = await client.database.rpc('tk_workspace');
  if (error) databaseError(error);
  const flow = await client.database.rpc('tk_flow_entries');
  if (flow.error) databaseError(flow.error);
  return parseWorkspace({ ...z.record(z.string(), z.unknown()).parse(data), myFlow: flow.data });
}
export async function requireAccount(roles?: readonly Role[], next?: string) {
  let context: Awaited<ReturnType<typeof authenticatedContext>>;
  try { context = await authenticatedContext(); }
  catch (error) {
    if (error instanceof HttpError && [401, 403].includes(error.status)) {
      const params = new URLSearchParams({ access: 'required' });
      if (next && rolesForPath(next)) params.set('next', next);
      redirect(`/login?${params}`);
    }
    throw error;
  }
  if (roles && !roles.includes(context.session.role)) redirect(destinations[context.session.role]);
  return context;
}
