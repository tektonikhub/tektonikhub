import { RouteGuard } from '@/components/auth/route-guard';
import { AdminScreen } from '@/components/features/admin';
import { requireAccount } from '@/lib/server/auth';

export default async function AdminPage() {
  await requireAccount(['admin', 'superadmin'], '/admin');
  return <RouteGuard roles={['admin', 'superadmin']}><AdminScreen /></RouteGuard>;
}
