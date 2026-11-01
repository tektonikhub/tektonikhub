'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="empty-state" role="alert"><h1>No pudimos abrir esta sección</h1><p>No se ha confirmado ninguna operación fallida. Reintenta o vuelve al acceso.</p><Button variant="primary" onClick={reset}>Reintentar</Button><a className="btn btn-secondary" href="/login">Ir al acceso</a></div>; }
