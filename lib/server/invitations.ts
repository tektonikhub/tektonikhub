import 'server-only';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { InsForgeClient, InsForgeError } from '@insforge/sdk';
import { appUrl } from '@/lib/auth/config';
import { databaseError, HttpError } from './http';

const targetSchema = z.object({ email: z.email(), name: z.string(), authUserId: z.string().nullable(), verified: z.boolean() });
export async function sendAccountActivation(admin: InsForgeClient, userId: string): Promise<void> {
  const result = await admin.database.rpc('tk_invitation_target', { p_user_id: userId });
  if (result.error) databaseError(result.error);
  if (!result.data) throw new HttpError(409, 'La cuenta ya no está habilitada para recibir la activación.');
  const target = targetSchema.parse(result.data);
  const redirectTo = `${appUrl()}/reset-password?activate=1`;
  let failure: InsForgeError | null = null;
  if (!target.authUserId) {
    const created = await admin.auth.signUp({
      email: target.email, name: target.name, password: `${randomBytes(32).toString('base64url')}Tk1!`, redirectTo,
    });
    failure = created.error;
  } else if (!target.verified) {
    failure = (await admin.auth.resendVerificationEmail({ email: target.email, redirectTo })).error;
  } else {
    failure = (await admin.auth.sendResetPasswordEmail({ email: target.email, redirectTo: `${appUrl()}/reset-password` })).error;
  }
  const marked = await admin.database.rpc('tk_mark_invitation', { p_user_id: userId, p_state: failure ? 'failed' : 'sent' });
  if (marked.error) databaseError(marked.error);
  if (failure) {
    console.error('InsForge activation email failed', { code: failure.error });
    throw new HttpError(502, 'La cuenta está guardada, pero no se confirmó el envío del correo. Reintenta «Enviar activación» desde Usuarios.');
  }
}
