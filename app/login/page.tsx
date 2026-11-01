import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { LoginScreen } from '@/components/features/login';
import { loginDestination } from '@/lib/auth/policy';
import type { Session } from '@/lib/domain/types';
import { authenticatedContext } from '@/lib/server/auth';
import { loginSetupRequired } from '@/lib/server/auth-throttle';
import { HttpError } from '@/lib/server/http';

export const metadata: Metadata = { title: 'Acceso al portal' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  let session: Session | null = null;
  let initialError = '';
  try { session = (await authenticatedContext()).session; }
  catch (error) {
    if (!(error instanceof HttpError) || ![401, 403, 503].includes(error.status)) throw error;
    if (error.status !== 401) initialError = error.message;
  }
  if (session) redirect(loginDestination(session.role, (await searchParams).next));
  let setupRequired = false;
  try { setupRequired = await loginSetupRequired(); }
  catch (error) {
    if (!(error instanceof HttpError)) throw error;
    initialError = error.message;
  }
  return <Suspense fallback={<p role="status">Preparando acceso…</p>}><LoginScreen setupRequired={setupRequired} initialError={initialError} /></Suspense>;
}
