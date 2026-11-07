'use client';

import { useEffect, useRef, useState } from 'react';
import { appStateSchema, loadAppState, saveAppState, stateMessage, type AppState } from '@/lib/studio/app-state';
import { isolatedHTML } from '@/lib/studio/engines';
import { Button } from '@/components/ui/button';

type Props = { html: string; title: string; className?: string; localKey?: string; appId?: string; version?: number };
export function GeneratedAppFrame({ html, title, className, localKey, appId, version }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const latest = useRef<AppState>({});
  const [document, setDocument] = useState<string | null>(null);
  const [status, setStatus] = useState('Cargando datos de la aplicación…');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, loaded = false, saving = false, paused = false;
    let pending: AppState | null = null, revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const channel = crypto.randomUUID();
    const cloud = Boolean(appId && version);
    function fail(cause: unknown) {
      paused = true;
      if (active) { setError(cause instanceof Error ? cause.message : 'No se han guardado los cambios.'); setStatus('Cambios sin guardar'); }
    }
    async function drain() {
      if (saving || paused || !pending || !appId || !version) return;
      saving = true;
      if (active) setStatus('Guardando…');
      try {
        while (pending && !paused) {
          const snapshot = pending; pending = null;
          const result = await saveAppState(appId, version, snapshot, revision);
          revision = result.revision;
        }
        if (active) setStatus('Guardado en tu cuenta');
      } catch (cause) { pending = latest.current; fail(cause); }
      finally { saving = false; }
    }
    function receive(event: MessageEvent) {
      if (!loaded || event.source !== iframe.current?.contentWindow || event.origin !== 'null') return;
      const state = stateMessage(event.data, channel);
      if (!state) return;
      latest.current = state;
      if (cloud) {
        pending = state;
        if (!paused) {
          setStatus('Cambios pendientes de guardar');
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { void drain(); }, 400);
        }
      } else if (localKey && !paused) {
        try { localStorage.setItem(localKey, JSON.stringify(state)); setStatus('Guardado en este navegador'); }
        catch (cause) { fail(cause); }
      }
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (pending || saving || paused) { event.preventDefault(); event.returnValue = ''; }
    }
    async function initialize() {
      if (!active) return;
      setDocument(null); setError(''); setStatus('Cargando datos de la aplicación…');
      try {
        const value = cloud ? await loadAppState(appId!, version!, controller.signal)
          : { state: appStateSchema.parse(localKey ? JSON.parse(localStorage.getItem(localKey) || '{}') : {}), revision: 0 };
        if (!active) return;
        revision = value.revision; latest.current = value.state; loaded = true;
        setDocument(isolatedHTML(html, { state: value.state, channel }));
        setStatus(cloud ? 'Guardado en tu cuenta' : localKey ? 'Guardado en este navegador' : 'Vista previa · exporta los datos para conservarlos');
      } catch (cause) { if (active) fail(cause); }
    }
    window.addEventListener('message', receive);
    window.addEventListener('beforeunload', beforeUnload);
    void Promise.resolve().then(initialize);
    return () => {
      active = false; controller.abort();
      window.removeEventListener('message', receive); window.removeEventListener('beforeunload', beforeUnload);
      if (timer) clearTimeout(timer);
      if (pending && !paused) void drain();
    };
  }, [html, appId, version, localKey, retry]);

  function exportState() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'tektonik-app-state', version: 1, storage: latest.current }, null, 2)], { type: 'application/json' }));
    const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = 'datos-aplicacion.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="generated-app-runtime">
    <div className="application-state-toolbar" aria-label="Datos de la aplicación">
      <span role="status">{status}</span>{document && <Button variant="ghost" onClick={exportState}>Exportar datos</Button>}
    </div>
    {error && <div className="application-error" role="alert"><p>{error} Exporta tus datos antes de recargar.</p>{!document && <Button onClick={() => setRetry(value => value + 1)}>Reintentar carga</Button>}</div>}
    {document && <iframe ref={iframe} className={className} title={title} sandbox="allow-scripts allow-downloads allow-forms" srcDoc={document} referrerPolicy="no-referrer" />}
  </div>;
}
