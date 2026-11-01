import { cookies } from 'next/headers';
import { clearAuthCookies, createServerClient } from '@insforge/sdk/ssr';
import { cookieSettings, insforgeOptions } from '@/lib/auth/config';
import { resetSchema } from '@/lib/auth/policy';
import { errorResponse, HttpError, jsonResponse, readJson, sameOrigin } from '@/lib/server/http';

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = resetSchema.parse(await readJson(request, 8000));
    const { error } = await createServerClient(insforgeOptions()).auth.resetPassword({ newPassword: input.password, otp: input.token });
    if (error) {
      if (error.statusCode >= 500) throw new HttpError(503, 'No se confirmó el cambio de contraseña. Vuelve a intentarlo.');
      throw new HttpError(400, 'El enlace no es válido o ha caducado. Solicita uno nuevo.');
    }
    clearAuthCookies(await cookies(), cookieSettings);
    return jsonResponse({ passwordUpdated: true });
  } catch (error) { return errorResponse(error); }
}
