import { RouteGuard } from '@/components/auth/route-guard';
import { SuperAdminScreen } from '@/components/features/super-admin';
import { requireAccount } from '@/lib/server/auth';

export default async function SuperAdminPage() {
  await requireAccount(['superadmin'], '/super-admin');
  return <RouteGuard roles={['superadmin']}><SuperAdminScreen /></RouteGuard>;
}
