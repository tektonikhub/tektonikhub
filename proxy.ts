import { NextResponse, NextRequest } from 'next/server';
import { updateSession } from '@insforge/sdk/ssr/middleware';
import { cookieSettings, insforgeOptions } from '@/lib/auth/config';

const authMutations = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/recover', '/api/auth/reset-password', '/api/auth/refresh']);

export async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const headers = new Headers(request.headers);
  headers.delete('x-tektonik-auth-unavailable');
  if (!authMutations.has(request.nextUrl.pathname)) {
    const sessionRequest = new NextRequest(request.url, { headers });
    const result = await updateSession({
      ...insforgeOptions(), ...cookieSettings, requestCookies: sessionRequest.cookies, responseCookies: response.cookies,
    });
    if (result.error && (result.error.statusCode === 0 || result.error.statusCode >= 500 || result.error.statusCode === 429)) {
      console.error('InsForge session refresh failed', { code: result.error.error, status: result.error.statusCode });
      headers.set('x-tektonik-auth-unavailable', '1');
      response.headers.delete('set-cookie');
    } else {
      headers.set('cookie', sessionRequest.cookies.toString());
    }
  }
  headers.set('x-tektonik-pathname', request.nextUrl.pathname);
  const forwarded = NextResponse.next({ request: { headers } });
  if (!headers.has('x-tektonik-auth-unavailable')) {
    for (const cookie of response.cookies.getAll()) forwarded.cookies.set(cookie);
  }
  return forwarded;
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|engines/|data.json|.*\\.(?:css|js|png|jpg|jpeg|svg|woff2)$).*)'],
};
