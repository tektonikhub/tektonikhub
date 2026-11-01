import { z } from 'zod';
import type { BrandTokens, Dataset, Session } from '@/lib/domain/types';
import { validateDataset, validateSession } from './validation';

export interface WorkspaceState { data: Dataset; session: Session }
export const brandDefaults: BrandTokens = {
  accent: '#FEFF44', bg: '#EFEFEB', card: '#FFFFFF', fg: '#111111', fgSoft: '#444444',
  line: '#E2E2DE', green: '#0B7A48', amber: '#B45309',
  displayFont: "'Barlow', system-ui, sans-serif", bodyFont: "'DM Sans', system-ui, sans-serif",
  rCard: '18px', rSm: '10px',
};
export function parseWorkspace(input: unknown): WorkspaceState {
  const raw = z.object({ session: z.unknown() }).passthrough().parse(input);
  const session = validateSession(raw.session);
  const data = validateDataset({
    ...raw, schemaVersion: 1, datasetVersion: 'insforge-v1', content: {},
    config: {
      defaultOrgId: session.orgId, defaultAuthorId: session.userId,
      demoRoles: { developer: session.userId, catalog: session.userId, admin: session.userId, superadmin: session.userId },
      upload: { maxFiles: 10, maxBytes: 26214400 }, brandDefaults, brandPresets: {},
      statusLabels: { approved: 'Aprobada', pending_review: 'Pendiente de revisión', rejected: 'Rechazada', changes_requested: 'Cambios solicitados' },
    },
  }, { scoped: true });
  if (!data.users.some(user => user.id === session.userId && user.orgId === session.orgId
    && user.role === session.role && user.enabled !== false && !user.deletedAt)) {
    throw new Error('La cuenta no coincide con el espacio autorizado.');
  }
  return { data, session };
}
