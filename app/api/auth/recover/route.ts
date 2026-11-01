import { z } from 'zod';
import { createServerClient } from '@insforge/sdk/ssr';
import { appUrl, insforgeOptions } from '@/lib/auth/config';
import { identifierSchema } from '@/lib/auth/policy';
import { authThrottle, resolveLoginEmail } from '@/lib/server/auth-throttle';
import { errorResponse, HttpError, jsonResponse, readJson, sameOrigin } from '@/lib/server/http';

const schema = z.object({ identifier: identifierSchema, mode: z.enum(['reset', 'verify']).default('reset') }).strict();
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const input = schema.parse(await readJson(request, 5000));
    const email = await resolveLoginEmail(input.identifier);
    await authThrottle(request, email, 'recover');
    const client = createServerClient(insforgeOptions());
    const result = input.mode === 'verify'
      ? await client.auth.resendVerificationEmail({ email, redirectTo: `${appUrl()}/reset-password?activate=1` })
      : await client.auth.sendResetPasswordEmail({ email, redirectTo: `${appUrl()}/reset-password` });
    if (result.error) {
      console.error('InsForge recovery email failed', { code: result.error.error });
      throw new HttpError(503, 'No se confirmó la solicitud de correo. Vuelve a intentarlo más tarde.');
    }
    return jsonResponse({ message: 'Si la cuenta está autorizada, recibirás un correo con los siguientes pasos.' });
  } catch (error) { return errorResponse(error); }
}
