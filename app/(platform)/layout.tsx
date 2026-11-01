import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { RouteGuard } from '@/components/auth/route-guard';
import { AppShell } from '@/components/layout/app-shell';
import { BLKProvider } from '@/components/providers/blk-provider';
import { requireAccount, workspaceForUser } from '@/lib/server/auth';
import { rolesForPath } from '@/lib/auth/policy';
export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get('x-tektonik-pathname') || '';
  await requireAccount(rolesForPath(pathname), pathname);
  const initial = await workspaceForUser();
  return <BLKProvider initial={initial}><RouteGuard><AppShell>{children}</AppShell></RouteGuard></BLKProvider>;
}
