import { Suspense } from 'react';
import { RouteGuard } from '@/components/auth/route-guard';
import { PortableWorkspace } from '@/components/studio/portable-workspace';
import { requireAccount } from '@/lib/server/auth';
import { studioRoles } from '@/lib/auth/policy';
import '@/styles/portable-next.css';

export default async function PortableUploadPage() {
  await requireAccount(studioRoles, '/studio/upload');
  return <RouteGuard roles={studioRoles}><Suspense fallback={<p role="status">Cargando ficheros…</p>}><PortableWorkspace /></Suspense></RouteGuard>;
}
