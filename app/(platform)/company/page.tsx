import { RouteGuard } from '@/components/auth/route-guard';
import { CompanyScreen } from '@/components/features/company';
import { Suspense } from 'react';

export default function CompanyPage() {
  return <RouteGuard roles={['developer', 'catalog', 'admin', 'superadmin']}><Suspense fallback={<p role="status">Cargando empresa…</p>}><CompanyScreen /></Suspense></RouteGuard>;
}
