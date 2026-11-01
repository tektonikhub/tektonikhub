import { Suspense } from 'react';
import { RouteGuard } from '@/components/auth/route-guard';
import { MiFlowScreen } from '@/components/features/mi-flow';

export default function MiFlowPage() {
  return <RouteGuard roles={['developer', 'catalog', 'admin', 'superadmin']}>
    <Suspense fallback={<p role="status">Cargando Mi Flow…</p>}><MiFlowScreen /></Suspense>
  </RouteGuard>;
}
