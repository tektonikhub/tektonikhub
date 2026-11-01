'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const [showPassword, setShowPassword] = useState(false), [capsLock, setCapsLock] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const en = language === 'en';
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
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
  return <main className="login-page" lang={language}>
    <header className="login-header">
      <Link href="/" className="login-brand" aria-label="Tektonik hub"><span className="brand-logo" aria-hidden="true">TH</span><span>Tektonik hub</span></Link>
      <nav className="login-languages" aria-label={en ? 'Language' : 'Idioma'}>
        <Button variant="ghost" aria-label="Español" aria-pressed={!en} onClick={() => setLanguage('es')}>ES</Button>
        <Button variant="ghost" aria-label="English" aria-pressed={en} onClick={() => setLanguage('en')}>EN</Button>
      </nav>
    </header>
    <section className="panel stack login-card" aria-labelledby="login-title">
      <div className="stack login-intro">
        <h1 id="login-title">{en ? 'Sign in' : 'Inicia sesión'}</h1>
        <p>{en ? 'Use your username or work email.' : 'Usa tu usuario o correo de trabajo.'}</p>
      </div>
      {setupRequired && <div role="status" className="business-notice"><strong>{en ? 'The portal is not ready yet' : 'El acceso aún no está preparado'}</strong><p>{en ? 'The portal has no authorized accounts yet. Ask the platform administrator to create the first account and send its activation email.' : 'El portal todavía no tiene cuentas autorizadas. Pide al responsable de la plataforma que cree la primera cuenta y envíe su correo de activación.'}</p></div>}
      <form className="stack login-form" onSubmit={login} aria-busy={busy}>
        <Field label={en ? 'Username or email' : 'Usuario o correo electrónico'} name="identifier" placeholder={en ? 'Your username or name@company.com' : 'Tu usuario o nombre@empresa.com'} autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={254} required disabled={busy || setupRequired} />
        <div className="stack login-password-field">
          <label className="field" htmlFor="login-password">{en ? 'Password' : 'Contraseña'}</label>
          <div className="login-password">
            <input id="login-password" className="input" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" maxLength={128} required disabled={busy || setupRequired}
              aria-describedby={capsLock ? 'login-caps-lock' : undefined}
              onKeyDown={event => setCapsLock(event.getModifierState('CapsLock'))}
              onKeyUp={event => setCapsLock(event.getModifierState('CapsLock'))}
              onBlur={() => setCapsLock(false)} />
            <Button variant="ghost" className="login-password-toggle" aria-controls="login-password" aria-pressed={showPassword}
              aria-label={en ? (showPassword ? 'Hide password' : 'Show password') : (showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña')}
              disabled={busy || setupRequired} onClick={() => setShowPassword(value => !value)}>
              {en ? (showPassword ? 'Hide' : 'Show') : (showPassword ? 'Ocultar' : 'Mostrar')}
            </Button>
          </div>
          {capsLock && <p id="login-caps-lock" role="status" className="login-caps-lock">{en ? 'Caps Lock is on.' : 'Bloq Mayús está activado.'}</p>}
        </div>
        <Link href="/reset-password" className="login-link login-recovery">{en ? 'Forgot your password?' : '¿Has olvidado tu contraseña?'}</Link>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="business-error">{error}</p>}
        {params.get('password') === 'updated' && <p className="business-notice" role="status">{en ? 'Password saved. Sign in with your new password.' : 'Contraseña guardada. Accede con tu nueva contraseña.'}</p>}
        <Button type="submit" variant="primary" className="login-submit" disabled={busy || setupRequired}>{busy ? (en ? 'Signing in…' : 'Accediendo…') : (en ? 'Sign in' : 'Entrar')}</Button>
      </form>
      <div className="login-help"><p>{en ? 'First time here?' : '¿Es tu primer acceso?'} <Link href="/reset-password?activate=1" className="login-link">{en ? 'Activate account' : 'Activar cuenta'}</Link></p><p>{en ? 'If you have not received an invitation, contact your administrator.' : 'Si no has recibido una invitación, contacta con tu administrador.'}</p></div>
    </section>
    <Link href="/" className="login-back login-link">{en ? 'Back to Tektonik hub' : 'Volver a Tektonik hub'}</Link>
  </main>;
}
