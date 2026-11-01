import { z } from 'zod';
import type { BrandTokens, Dataset, DemoSession, JSONValue, SubmissionFields } from '../domain/types';

export const roles = ['developer', 'catalog', 'admin', 'superadmin'] as const;
const id = z.string().regex(/^[a-zA-Z0-9#_-]+$/);
const natural = z.number().int().nonnegative().safe();
const version = natural.min(1);
const strings = z.array(z.string());
const json: z.ZodType<JSONValue> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]));
const brandShape = { accent: z.string(), bg: z.string(), card: z.string(), fg: z.string(), fgSoft: z.string(), line: z.string(), green: z.string(), amber: z.string(), displayFont: z.string(), bodyFont: z.string(), rCard: z.string(), rSm: z.string() };
export const brandSchema = z.object(brandShape).strict().refine(tokens => Object.entries(tokens).every(([key, value]) => key.endsWith('Font') ? /^[a-zA-Z0-9 ,"'\-]+$/.test(value) : key.startsWith('r') ? /^\d{1,3}px$/.test(value) : /^#[0-9a-f]{6}$/i.test(value)), 'Token de marca inválido.');
const attachment = z.object({ name: z.string().trim().min(1).max(255), size: z.number().finite().nonnegative(), type: z.string().max(128) });
const schema = z.object({
  schemaVersion: z.literal(1), datasetVersion: z.string().min(1), revision: natural,
  config: z.object({ defaultOrgId: id, defaultAuthorId: id, demoRoles: z.object({ developer: id, catalog: id, admin: id, superadmin: id }), upload: z.object({ maxFiles: natural, maxBytes: natural }), brandDefaults: brandSchema, brandPresets: z.record(z.string(), brandSchema), statusLabels: z.object({ approved: z.string(), pending_review: z.string(), rejected: z.string(), changes_requested: z.string() }) }),
  categories: z.array(z.object({ id, label: z.string() })), content: z.record(z.string(), json),
  myFlow: z.array(z.object({ appId: id, favorite: z.boolean(), createdAt: z.iso.datetime({ offset: true }) }).strict()).max(1000),
  organizations: z.array(z.object({ id, name: z.string().min(1), initials: z.string(), plan: id, members: natural, compliance: z.number().finite().nullable(), status: z.enum(['active', 'active-amber', 'suspended', 'pending']), adminId: id, createdAt: z.string(), date: z.string(), domain: z.string(), lastAccess: z.string(), brand: brandSchema.optional(), profile: z.object({ bio: z.string().max(2000), bannerTitle: z.string().max(160), bannerDesc: z.string().max(2000) }).optional(), apps: natural.optional(), pending: natural.optional(), system: z.boolean().optional() })),
  users: z.array(z.object({ id, orgId: id, role: z.enum(roles), name: z.string().min(1), initials: z.string(), dept: z.string(), email: z.string().optional(), username: z.string().optional(), enabled: z.boolean().optional(), accountStatus: z.enum(['reserved', 'sent', 'failed', 'active']).optional(), deletedAt: z.string().nullable().optional() })),
  apps: z.array(z.object({ id, orgId: id, authorId: id, title: z.string(), area: id, desc: z.string(), longDesc: z.string().optional(), tagline: z.string(), impact: z.string(), dataNote: z.string(), repoUrl: z.string(), tech: strings, attachments: z.array(attachment), tags: strings, security: strings, metrics: z.object({ hours: z.number().finite().nonnegative(), users: natural, rating: z.union([z.string(), z.number().finite()]) }), reviewStatus: z.enum(['approved', 'pending_review', 'changes_requested', 'rejected']), maturity: z.string(), version, ticket: z.string(), createdAt: z.string(), updatedAt: z.string(), generatedHtml: z.string().max(300000).optional(), environment: z.string().optional(), certificate: z.string().optional() })),
  reviews: z.array(z.object({ id, appId: id, reviewerId: id, reviewerName: z.string().min(1).optional(), action: z.enum(['approved', 'rejected', 'changes_requested']), reason: z.string(), environment: z.string(), version, createdAt: z.string(), checks: z.object({ security: z.boolean(), data: z.boolean() }).optional() })),
  events: z.array(z.object({ id, orgId: id, appId: id.optional(), actorId: id, actorName: z.string().min(1).optional(), action: z.string(), createdAt: z.string() })),
  plans: z.array(z.object({ id, name: z.string().trim().min(1), price: z.number().finite().nonnegative().nullable() })),
  policies: z.array(z.object({ id, name: z.string().trim().min(1), description: z.string(), enabled: z.boolean(), orgId: id.optional(), version: version.optional(), createdAt: z.string().optional(), updatedAt: z.string().optional() }))
});

export function validateDataset(input: unknown, { scoped = false }: { scoped?: boolean } = {}): Dataset {
  const data: Dataset = schema.parse(input);
  for (const rows of [data.categories, data.organizations, data.users, data.apps, data.reviews, data.events, data.plans, data.policies]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Identificadores duplicados.');
  }
  const orgs = new Map(data.organizations.map(row => [row.id, row]));
  const users = new Map(data.users.map(row => [row.id, row]));
  const apps = new Map(data.apps.map(row => [row.id, row]));
  if (new Set(data.myFlow.map(entry => entry.appId)).size !== data.myFlow.length) throw new Error('Mini apps duplicadas en Mi Flow.');
  for (const entry of data.myFlow) {
    const app = apps.get(entry.appId);
    const org = app && orgs.get(app.orgId);
    if (!app || app.orgId !== data.config.defaultOrgId || app.reviewStatus !== 'approved'
      || !org || !['active', 'active-amber'].includes(org.status)) throw new Error('Mini app no autorizada en Mi Flow.');
  }
  for (const org of data.organizations) {
    const admin = users.get(org.adminId);
    if (!data.plans.some(plan => plan.id === org.plan) || !admin || admin.orgId !== org.id || !['admin', 'superadmin'].includes(admin.role)) throw new Error('Organización o administrador inválido.');
  }
  for (const user of data.users) if (!orgs.has(user.orgId)) throw new Error('Organización de usuario inválida.');
  for (const app of data.apps) if (!orgs.has(app.orgId) || users.get(app.authorId)?.orgId !== app.orgId || !data.categories.some(category => category.id === app.area)) throw new Error('Relaciones de aplicación inválidas.');
  for (const review of data.reviews) if (!apps.has(review.appId) || (!users.has(review.reviewerId) && !(scoped && review.reviewerName))) throw new Error('Relaciones de revisión inválidas.');
  for (const event of data.events) if (!orgs.has(event.orgId) || (!users.has(event.actorId) && !(scoped && event.actorName)) || (event.appId !== undefined && apps.get(event.appId)?.orgId !== event.orgId)) throw new Error('Relaciones de evento inválidas.');
  for (const policy of data.policies) if (policy.orgId !== undefined && (!orgs.has(policy.orgId) || policy.version === undefined)) throw new Error('Ámbito o versión de política inválidos.');
  if (!orgs.has(data.config.defaultOrgId) || !users.has(data.config.defaultAuthorId)) throw new Error('Identidades predeterminadas inválidas.');
  return data;
}
export function validateSession(input: unknown): DemoSession { return z.object({ userId: id, orgId: id, role: z.enum(roles) }).parse(input); }
export function safeBrand(input: BrandTokens): BrandTokens { return brandSchema.parse(input); }
export function text(value: string, max: number, label: string, min = 0): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error(`${label}: longitud no válida (${min}–${max}).`);
  return value.trim();
}
export function submissionFields(fields: SubmissionFields, seed: Dataset) {
  const title = text(fields.title, 60, 'Título', 1), desc = text(fields.desc, 800, 'Descripción', 30);
  if (!seed.categories.some(row => row.id === fields.area)) throw new Error('Selecciona una categoría válida.');
  const attachments = z.array(attachment).max(seed.config.upload.maxFiles).parse(fields.attachments || []);
  if (attachments.reduce((total, file) => total + file.size, 0) > seed.config.upload.maxBytes) throw new Error('El tamaño total supera el límite de adjuntos.');
  const repoUrl = text(fields.repoUrl || '', 1000, 'URL');
  if (repoUrl) { let url: URL; try { url = new URL(repoUrl); } catch { throw new Error('Introduce una URL válida.'); } if (!['https:', 'http:'].includes(url.protocol)) throw new Error('La URL debe usar HTTP o HTTPS.'); }
  return { title, desc, area: fields.area, tagline: text(fields.tagline || '', 100, 'Resumen'), impact: text(fields.impact || '', 500, 'Impacto'), dataNote: text(fields.dataNote || '', 2000, 'Nota de datos'), repoUrl, tech: fields.aiTool ? [text(fields.aiTool, 100, 'Herramienta IA')] : [], attachments, ...(fields.generatedHtml === undefined ? {} : { generatedHtml: text(fields.generatedHtml, 300000, 'HTML generado') }) };
}
