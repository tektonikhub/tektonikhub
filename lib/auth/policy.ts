import { z } from 'zod';
import type { Role } from '@/lib/domain/types';

export const destinations: Record<Role, string> = {
  developer: '/profile', catalog: '/catalog', admin: '/admin', superadmin: '/super-admin',
};
const access: Record<string, readonly Role[]> = {
  '/profile': ['developer', 'catalog', 'admin', 'superadmin'],
  '/catalog': ['developer', 'catalog', 'admin', 'superadmin'],
  '/company': ['developer', 'catalog', 'admin', 'superadmin'],
  '/studio': ['developer'],
  '/admin': ['admin', 'superadmin'],
  '/super-admin': ['superadmin'],
};
export function rolesForPath(path: string): readonly Role[] | undefined {
  return access[path];
}
export function loginDestination(role: Role, next: unknown): string {
  return typeof next === 'string' && access[next]?.includes(role) ? next : destinations[role];
}
export const identifierSchema = z.string().trim().min(3, 'Introduce un usuario o correo válido.').max(254, 'El usuario o correo es demasiado largo.').transform(value => value.toLowerCase())
  .refine(value => z.email().safeParse(value).success || /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value), 'Introduce un usuario o correo válido.');
export const loginSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1, 'Introduce tu contraseña.').max(128, 'La contraseña es demasiado larga.'),
  next: z.string().max(100).optional(),
}).strict();
export const newPasswordSchema = z.string().min(15, 'La contraseña debe tener al menos 15 caracteres.').max(128);
export const resetSchema = z.object({
  token: z.string().min(1).max(4096),
  password: newPasswordSchema,
}).strict();
export function validResetLink(params: Pick<URLSearchParams, 'get'>): string | null {
  const token = params.get('token');
  return params.get('insforge_status') === 'ready' && params.get('insforge_type') === 'reset_password'
    && token && token.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(token) ? token : null;
}
export function trustedOrigin(origin: string | null, appUrl: string, development = false): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.origin === new URL(appUrl).origin) return true;
    return development && ['http://127.0.0.1:3000', 'http://localhost:3000'].includes(origin);
  } catch { return false; }
}
