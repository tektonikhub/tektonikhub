import { Suspense } from 'react';
import { RouteGuard } from '@/components/auth/route-guard';
import { CatalogScreen } from '@/components/features/catalog';

export default function CatalogPage() {
  return <RouteGuard roles={['developer', 'catalog', 'admin', 'superadmin']}><Suspense fallback={<p role="status">Cargando catálogo…</p>}><CatalogScreen /></Suspense></RouteGuard>;
}
