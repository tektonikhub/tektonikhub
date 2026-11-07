'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';
import { applicationHref, loadApplicationSource } from '@/lib/data/app-access';
import { approvedCatalogApps } from '@/lib/data/mi-flow';
import { GeneratedAppFrame } from '@/components/studio/generated-app-frame';
import type { App } from '@/lib/domain/types';

export function ApplicationView({ appId }: { appId: string }) {
  const { data, org, user } = useBLK();
  const pathname = usePathname();
  const params = useSearchParams();
  const app = approvedCatalogApps(data, org).find(app => app.id === appId);
  return <section className="application-view" aria-label="Aplicación del catálogo" data-testid="application-view">
    <header className="application-toolbar">
      <Link className="btn btn-secondary" href={applicationHref(pathname, params)}><ArrowLeft size={16} aria-hidden="true" />Volver</Link>
      <div className="application-title"><h1>{app?.title || 'Aplicación no disponible'}</h1>{app && <span>Versión aprobada · v{app.version}</span>}</div>
      {app && <Button variant="ghost" aria-label="Recargar aplicación" title="Recargar aplicación" onClick={() => window.location.reload()}><RotateCcw size={16} aria-hidden="true" /></Button>}
    </header>
    {app ? <ApplicationPreview key={`${user?.id}:${org?.id}:${app.id}:${app.version}`} app={app} />
      : <div className="application-message" role="alert"><p>Esta aplicación no existe o ya no está aprobada en tu organización.</p></div>}
  </section>;
}

function ApplicationPreview({ app }: { app: App }) {
  const { id, version } = app;
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; html: string } | { status: 'error'; message: string }>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    void loadApplicationSource({ id, version }).then(html => {
      if (active) setState({ status: 'ready', html });
    }).catch(error => {
      if (active) setState({ status: 'error', message: error instanceof Error ? error.message : 'No se pudo abrir la aplicación.' });
    });
    return () => { active = false; };
  }, [id, version]);
  if (state.status === 'loading') return <div className="application-message" role="status">Cargando aplicación…</div>;
  if (state.status === 'error') return <div className="application-message application-error" role="alert">
    <p>{state.message}</p><Button onClick={() => window.location.reload()}>Reintentar</Button>
  </div>;
  return <GeneratedAppFrame className="application-frame" title={`Aplicación ${app.title}`} html={state.html} appId={id} version={version} />;
}
