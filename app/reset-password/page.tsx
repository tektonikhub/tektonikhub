import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PasswordRecovery } from '@/components/auth/password-recovery';
export const metadata: Metadata = { title: 'Acceso y contraseña', referrer: 'no-referrer' };
export default function ResetPasswordPage() {
  return <Suspense fallback={<p role="status">Preparando acceso…</p>}><PasswordRecovery /></Suspense>;
}
