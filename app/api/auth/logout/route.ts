import { cookies } from 'next/headers';
import { clearAuthCookies, createAuthActions } from '@insforge/sdk/ssr';
import { cookieSettings, insforgeOptions } from '@/lib/auth/config';
import { errorResponse, HttpError, jsonResponse, sameOrigin } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const store = await cookies();
    const actions = createAuthActions({ ...insforgeOptions(), ...cookieSettings, cookies: store });
    const result = await actions.signOut();
    clearAuthCookies(store, cookieSettings);
    if (result.error) throw new HttpError(503, 'Las cookies se han cerrado, pero no se pudo completar el cierre de sesión.');
    return jsonResponse({ signedOut: true });
  } catch (error) { return errorResponse(error); }
}
