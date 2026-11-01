import { Suspense } from 'react';
import { RouteGuard } from '@/components/auth/route-guard';
import { ProfileScreen } from '@/components/features/profile';

export default function ProfilePage() {
  return <RouteGuard roles={['developer', 'catalog', 'admin', 'superadmin']}><Suspense fallback={<p role="status">Cargando perfil…</p>}><ProfileScreen /></Suspense></RouteGuard>;
}
