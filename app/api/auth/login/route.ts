import { cookies } from 'next/headers';
import { clearAuthCookies, createAuthActions } from '@insforge/sdk/ssr';
import { cookieSettings, insforgeOptions } from '@/lib/auth/config';
import { loginDestination, loginSchema } from '@/lib/auth/policy';
import { authenticatedContext } from '@/lib/server/auth';
import { authThrottle, resolveLoginEmail } from '@/lib/server/auth-throttle';
import { errorResponse, HttpError, jsonResponse, readJson, sameOrigin } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = loginSchema.parse(await readJson(request, 5000));
    const email = await resolveLoginEmail(input.identifier);
    await authThrottle(request, email, 'login');
    const store = await cookies();
    const actions = createAuthActions({ ...insforgeOptions(), ...cookieSettings, cookies: store });
    const { data, error } = await actions.signInWithPassword({ email, password: input.password });
    if (error || !data?.user) {
      if (!error || error.statusCode === 0 || error.statusCode >= 500) {
        console.error('InsForge sign-in failed', { code: error?.error, status: error?.statusCode });
        throw new HttpError(503, 'El servicio de autenticación no está disponible.');
      }
      if (error.statusCode === 429) throw new HttpError(429, 'Demasiados intentos. Vuelve a intentarlo más tarde.');
      throw new HttpError(401, 'Credenciales incorrectas o cuenta pendiente de activación.');
    }
    try {
      const { session, authUserId } = await authenticatedContext();
      if (authUserId !== data.user.id) throw new HttpError(503, 'No se pudo confirmar la nueva sesión. Vuelve a iniciar sesión.');
      return jsonResponse({ redirectTo: loginDestination(session.role, input.next) });
    } catch (error) {
      const result = await actions.signOut();
      clearAuthCookies(store, cookieSettings);
      if (result.error) console.error('InsForge rejected session cleanup failed', { code: result.error.error });
      if (error instanceof HttpError && [401, 403].includes(error.status)) {
        throw new HttpError(401, 'Credenciales incorrectas o cuenta pendiente de activación.');
      }
      throw error;
    }
  } catch (error) { return errorResponse(error); }
}
