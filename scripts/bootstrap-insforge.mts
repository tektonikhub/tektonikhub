import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createAdminClient } from '@insforge/sdk';
import { z } from 'zod';

async function main() {
  const usage = 'Uso: npm run accounts:bootstrap -- <correo> <usuario> [--resend]';
  if (process.argv.includes('--help')) { console.log(usage); return; }
  const input = z.object({
    email: z.email().transform(value => value.toLowerCase()),
    username: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/),
  }).safeParse({ email: process.argv[2], username: process.argv[3] });
  if (!input.success) throw new Error(`${usage}\nIntroduce un correo válido y un usuario de 3 a 64 caracteres (letras, números, puntos, guiones o guiones bajos).`);
  for (const file of ['.env.local', '.env']) if (existsSync(file)) loadEnvFile(file);
  const { insforgeOptions } = await import('../lib/auth/config');
  const { sendAccountActivation } = await import('../lib/server/invitations');
  const { email, username } = input.data;
  const apiKey = process.env.INSFORGE_API_KEY;
  if (!apiKey) throw new Error('Falta INSFORGE_API_KEY en el entorno del servidor.');
  const admin = createAdminClient({ baseUrl: insforgeOptions().baseUrl, apiKey });
  const existing = await admin.database.from('users').select('id,email,username').eq('role', 'superadmin').limit(2);
  if (existing.error) throw new Error(`No se pudo comprobar la cuenta inicial: ${existing.error.message}`);
  const accounts = z.array(z.object({ id: z.uuid(), email: z.email(), username: z.string() })).parse(existing.data);
  let userId: string;
  if (accounts.length) {
    const account = accounts.find(value => value.email.toLowerCase() === email && value.username.toLowerCase() === username.toLowerCase());
    if (!account || !process.argv.includes('--resend')) throw new Error('La plataforma ya tiene un superadministrador. Para reenviar su activación, repite el mismo correo y usuario con --resend.');
    userId = account.id;
  } else {
    const result = await admin.database.rpc('tk_bootstrap', { p_email: email, p_username: username });
    if (result.error) throw new Error(`No se pudo reservar la primera cuenta: ${result.error.message}`);
    userId = z.object({ userId: z.uuid(), orgId: z.uuid() }).parse(result.data).userId;
  }
  await sendAccountActivation(admin, userId);
  console.log('Primera cuenta reservada y correo de activación solicitado. No se ha generado ninguna contraseña para compartir.');
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'No se completó el alta inicial.'); process.exitCode = 1; });
