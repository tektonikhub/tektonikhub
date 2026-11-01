'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { destinations } from '@/lib/auth/policy';
import { announceAuthChange, requestJson } from '@/lib/data/http-client';
import { Field } from './shared';

export function LoginScreen({ setupRequired = false, initialError = '' }: { setupRequired?: boolean; initialError?: string }) {
  const params = useSearchParams();
  const [language, setLanguageValue] = useState<'es' | 'en'>('es');
  const [busy, setBusy] = useState(false), [error, setError] = useState(initialError);
  const en = language === 'en';
  useEffect(() => {
    void Promise.resolve().then(() => {
      try { if (localStorage.getItem('blkunit:lang') === 'en') setLanguageValue('en'); }
      catch { setError('No se pudo recuperar la preferencia de idioma.'); }
    });
  }, []);
  function setLanguage(value: 'es' | 'en') {
    setLanguageValue(value);
    try { localStorage.setItem('blkunit:lang', value); }
    catch { setError('El navegador no permite guardar la preferencia de idioma.'); }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || setupRequired) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const result = z.object({ redirectTo: z.enum([...Object.values(destinations), '/company', '/studio']) }).parse(
        await requestJson('/api/auth/login', { method: 'POST', body: JSON.stringify({
          identifier: fields.get('identifier'), password: fields.get('password'),
          ...(params.get('next') ? { next: params.get('next') } : {}),
        }) }),
      );
      announceAuthChange();
      window.location.replace(result.redirectTo);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.');
      setBusy(false);
    }
  }
  return <main className="business-login">
    <section className="business-login-story"><Link href="/" className="business-login-logo">Tektonik<span>hub</span></Link><span className="business-label">THE AI-NATIVE WORKFORCE</span><h1>Tu talento.<br />Tu IA.<br />Tu impacto.</h1><p>Un espacio para crear, revisar y compartir las herramientas que tu equipo necesita.</p></section>
    <section className="panel stack business-login-panel">
      <div className="business-actions"><Button variant={en ? 'ghost' : 'primary'} onClick={() => setLanguage('es')}>ES</Button><Button variant={en ? 'primary' : 'ghost'} onClick={() => setLanguage('en')}>EN</Button></div>
      <h2>{en ? 'Sign in' : 'Acceso al portal'}</h2>
      <p>{en ? 'Sign in with your account. Your organization and permissions are assigned automatically.' : 'Entra con tu cuenta. Tu organización y tus permisos se asignan automáticamente.'}</p>
      {setupRequired && <p role="status" className="business-notice">{en ? 'The portal has no authorized accounts yet. The platform administrator must create the first account and send its activation email before anyone can sign in.' : 'El portal todavía no tiene cuentas autorizadas. El responsable de la plataforma debe crear la primera cuenta y enviar su correo de activación antes de poder acceder.'}</p>}
      <form className="stack" onSubmit={login} aria-busy={busy}>
        <Field label={en ? 'Username or email' : 'Usuario o correo electrónico'} name="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={254} required disabled={busy || setupRequired} />
        <Field label={en ? 'Password' : 'Contraseña'} name="password" type="password" autoComplete="current-password" maxLength={128} required disabled={busy || setupRequired} />
        {error && <p role="alert" className="business-error">{error}</p>}
        {params.get('password') === 'updated' && <p className="business-notice" role="status">{en ? 'Password saved. Sign in with your new password.' : 'Contraseña guardada. Accede con tu nueva contraseña.'}</p>}
        <Button type="submit" disabled={busy || setupRequired}>{busy ? (en ? 'Signing in…' : 'Accediendo…') : (en ? 'Sign in' : 'Entrar')}</Button>
      </form>
      <Link href="/reset-password">{en ? 'Forgot your password?' : '¿Has olvidado tu contraseña?'}</Link>
      <p className="business-meta">{en ? 'Accounts are created by an administrator. If you were invited, verify your email and set your password.' : 'Las cuentas las crea un administrador. Si has recibido una invitación, verifica tu correo y establece tu contraseña.'} <Link href="/reset-password?activate=1">{en ? 'Activate account' : 'Activar cuenta'}</Link></p>
      <Link href="/">{en ? 'Back to Tektonik hub' : 'Volver a Tektonik hub'}</Link>
    </section>
  </main>;
}
