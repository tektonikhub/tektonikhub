import { Suspense } from 'react';
import { RouteGuard } from '@/components/auth/route-guard';
import { StudioWorkspace } from '@/components/studio/studio-workspace';
import '@/styles/studio-next.css';
import { requireAccount } from '@/lib/server/auth';
export default async function StudioPage(){
  await requireAccount(['developer'], '/studio');
  return <RouteGuard roles={['developer']}><Suspense fallback={<p role="status">Cargando Studio…</p>}><StudioWorkspace/></Suspense></RouteGuard>;
}
