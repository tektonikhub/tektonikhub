'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RemoteBLKRepository } from '@/lib/data/remote-repository';
import type { WorkspaceState } from '@/lib/data/workspace';
import type { BLKRepository } from '@/lib/data/repository';
import type { Dataset, DemoSession, Organization, User } from '@/lib/domain/types';
import { applyBrand } from '@/lib/config/branding';
import { Button } from '@/components/ui/button';

type ActionResult<T> = { ok: true; value: T } | { ok: false };
type Context = { data: Dataset; user: User | null; org: Organization | null; repository: BLKRepository; language: 'es' | 'en'; setLanguage: (language: 'es' | 'en') => void; notify: (message: string, kind?: 'success' | 'error' | 'info') => void; action: <T>(operation: () => Promise<T>, success?: string) => Promise<ActionResult<T>> };
const BLKContext = createContext<Context | null>(null);
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'No se ha confirmado el cambio. Inténtalo otra vez.';

export function BLKProvider({ children, initial }: { children: ReactNode; initial: WorkspaceState }) {
  const [ready, setReady] = useState<{ repository: BLKRepository; data: Dataset; session: DemoSession | null } | null>(() => ({ repository: new RemoteBLKRepository(initial), data: initial.data, session: initial.session }));
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguageValue] = useState<'es' | 'en'>('es');
  const [toast, setToast] = useState<{ message: string; kind: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string, kind: 'success' | 'error' | 'info' = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 8000 : 4500);
  }, []);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const repository = new RemoteBLKRepository(initial);
    void repository.initialize().then(() => {
      if (!active) return;
      const update = () => {
        const failure = repository.getError();
        if (failure) { setError(messageOf(failure)); return; }
        setError(null);
        setReady({ repository, data: repository.getSnapshot(), session: repository.getSession() });
      };
      unsubscribe = repository.subscribe(update);
      update();
      setError(null);
      try { if (localStorage.getItem('blkunit:lang') === 'en') setLanguageValue('en'); } catch { notify('No se pudo recuperar la preferencia de idioma.', 'info'); }
    }).catch((failure: unknown) => { if (active) setError(messageOf(failure)); });
    return () => { active = false; unsubscribe?.(); repository.destroy(); };
  }, [initial, notify]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const session = ready?.session;
  const user = session ? ready?.data.users.find(row => row.id === session.userId && row.role === session.role && row.orgId === session.orgId) ?? null : null;
  const org = user ? ready?.data.organizations.find(row => row.id === user.orgId) ?? null : null;
  useEffect(() => {
    if (!ready) return;
    applyBrand({ ...ready.data.config.brandDefaults, ...org?.brand }, document.documentElement.style);
    return () => applyBrand(ready.data.config.brandDefaults, document.documentElement.style);
  }, [ready, org]);
  const setLanguage = useCallback((value: 'es' | 'en') => {
    try { localStorage.setItem('blkunit:lang', value); setLanguageValue(value); document.documentElement.lang = value; } catch (failure) { notify(messageOf(failure), 'error'); }
  }, [notify]);
  const action = useCallback(async <T,>(operation: () => Promise<T>, success?: string): Promise<ActionResult<T>> => {
    try { const value = await operation(); if (success) notify(success); return { ok: true, value }; }
    catch (failure) { notify(messageOf(failure), 'error'); return { ok: false }; }
  }, [notify]);
  if (error) return <main className="empty-state" role="alert"><div className="brand-logo">TH</div><h1>No se pudieron cargar los datos del servidor</h1><p>{error}</p><p>No se han reemplazado tus datos con una demostración. Los borradores Studio se conservan.</p><Button onClick={() => window.location.reload()}>Reintentar</Button></main>;
  if (!ready) return <div className="loading-state" role="status"><div className="brand-logo">TH</div><p>Preparando tu espacio de trabajo…</p></div>;
  return <BLKContext.Provider value={{ data: ready.data, user, org, repository: ready.repository, language, setLanguage, notify, action }}>{children}<div className="toast-region" aria-live="polite" aria-atomic="true">{toast && <div className={`toast toast-${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.message}<button onClick={() => setToast(null)} aria-label="Cerrar notificación">×</button></div>}</div></BLKContext.Provider>;
}
export function useBLK() { const context = useContext(BLKContext); if (!context) throw new Error('useBLK requiere un BLKProvider listo.'); return context; }
