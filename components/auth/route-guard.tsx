'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useBLK } from '@/hooks/use-blk';
import type { Role } from '@/lib/domain/types';

export function RouteGuard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, org } = useBLK();
  const path = usePathname();
  useEffect(() => { if (!user) window.location.replace(`/login?next=${encodeURIComponent(path)}`); }, [user, path]);
  if (!user) return <div className="empty-state"><h1>Accede a Tektonik hub</h1><Link className="btn btn-primary" href="/login">Iniciar sesión</Link></div>;
  if ((roles && !roles.includes(user.role)) || (user.role !== 'superadmin' && (!org || ['suspended', 'pending'].includes(org.status)))) {
    return <div className="empty-state" role="alert"><ShieldAlert size={36} /><h1>Acceso no disponible</h1><p>Tu cuenta no tiene acceso a esta sección o la organización no está activa.</p><Link className="btn btn-primary" href="/profile">Volver a mi perfil</Link><p className="muted">Los permisos se comprueban también en el servidor y en PostgreSQL.</p></div>;
  }
  return children;
}
