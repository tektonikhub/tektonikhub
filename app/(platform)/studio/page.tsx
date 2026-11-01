import { Suspense } from 'react';
import { RouteGuard } from '@/components/auth/route-guard';
import { StudioWorkspace } from '@/components/studio/studio-workspace';
import '@/styles/studio-next.css';
import { requireAccount } from '@/lib/server/auth';
import { studioRoles } from '@/lib/auth/policy';
export default async function StudioPage(){
  await requireAccount(studioRoles, '/studio');
  return <RouteGuard roles={studioRoles}><Suspense fallback={<p role="status">Cargando Studio…</p>}><StudioWorkspace/></Suspense></RouteGuard>;
}
