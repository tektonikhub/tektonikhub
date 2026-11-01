import type { ReactNode } from 'react';
const labels: Record<string, string> = { approved: 'Aprobada', pending_review: 'Pendiente de revisión', changes_requested: 'Cambios solicitados', rejected: 'Rechazada', active: 'Activa', 'active-amber': 'Activa · atención', suspended: 'Suspendida', pending: 'Pendiente', beta: 'Beta', new: 'Nueva' };
export function Badge({ status = '', children }: { status?: string; children?: ReactNode }) {
  const tone = ['approved', 'active'].includes(status) ? 'success' : ['rejected', 'suspended'].includes(status) ? 'danger' : ['pending', 'pending_review', 'changes_requested', 'active-amber'].includes(status) ? 'warning' : 'neutral';
  return <span className={`badge badge-${tone}`}>{children ?? labels[status] ?? status}</span>;
}
