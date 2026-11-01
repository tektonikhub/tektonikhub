import { createRefreshAuthRouter } from '@insforge/sdk/ssr';
import { cookieSettings, insforgeOptions } from '@/lib/auth/config';
import { errorResponse, sameOrigin } from '@/lib/server/http';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const response = await createRefreshAuthRouter({ ...insforgeOptions(), ...cookieSettings }).POST(request);
    if (response.status >= 500 || response.status === 429) {
      console.error('InsForge refresh endpoint failed', { status: response.status });
      response.headers.delete('set-cookie');
    }
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) { return errorResponse(error); }
}
