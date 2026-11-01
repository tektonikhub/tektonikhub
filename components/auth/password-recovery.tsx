'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/features/shared';
import { newPasswordSchema, validResetLink } from '@/lib/auth/policy';
import { announceAuthChange, requestJson } from '@/lib/data/http-client';
import '@/styles/business.css';

export function PasswordRecovery() {
  const params = useSearchParams();
  const [token] = useState(() => validResetLink(params));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const activating = params.get('activate') === '1';
  useEffect(() => { if (token) window.history.replaceState(null, '', '/reset-password'); }, [token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget, event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null);
    setBusy(true); setError(''); setMessage('');
    try {
      if (token) {
        const password = newPasswordSchema.parse(String(fields.get('password') || ''));
        if (password !== fields.get('confirmation')) throw new Error('Las contraseñas no coinciden.');
        await requestJson('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
        announceAuthChange();
        window.location.replace('/login?password=updated');
      } else {
        const mode = fields.get('mode') === 'verify' ? 'verify' : 'reset';
        await requestJson('/api/auth/recover', { method: 'POST', body: JSON.stringify({ identifier: fields.get('identifier'), mode }) });
        setMessage('Si la cuenta está autorizada, recibirás un correo con los siguientes pasos. Revisa también la carpeta de spam.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se confirmó la solicitud.'); }
    finally { setBusy(false); }
  }
  return <main className="business-login"><section className="business-login-story"><Link href="/" className="business-login-logo">Tektonik<span>hub</span></Link><h1>Tu cuenta.<br />Tu espacio.</h1><p>Acceso seguro a las herramientas de tu organización.</p></section><section className="panel stack business-login-panel"><h2>{token ? 'Establece tu contraseña' : activating ? 'Activa tu cuenta' : 'Recuperar contraseña'}</h2><p>{token ? 'Usa al menos 15 caracteres. No compartas tu contraseña.' : activating ? 'Confirma primero tu correo mediante el enlace recibido. Después solicita aquí el enlace para crear tu contraseña.' : 'Te enviaremos un enlace al correo asociado a tu cuenta.'}</p>{!token && params.has('token') && <p role="alert">El enlace está incompleto o no es válido. Solicita uno nuevo.</p>}<form className="stack" onSubmit={submit} aria-busy={busy}>{token ? <><Field label="Nueva contraseña" name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required /><Field label="Repetir contraseña" name="confirmation" type="password" autoComplete="new-password" minLength={15} maxLength={128} required /></> : <Field label="Usuario o correo electrónico" name="identifier" autoComplete="username" maxLength={254} required />}{error && <p className="business-error" role="alert">{error}</p>}{message && <p className="business-notice" role="status">{message}</p>}<Button type="submit" name="mode" value="reset" disabled={busy}>{busy ? 'Procesando…' : token ? 'Guardar contraseña' : 'Enviar enlace de contraseña'}</Button>{!token && <Button type="submit" name="mode" value="verify" variant="secondary" disabled={busy}>Reenviar verificación de correo</Button>}</form><Link href="/login">Volver al acceso</Link></section></main>;
}
