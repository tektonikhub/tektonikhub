import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createLocalRepository, DATA_KEY, LocalBLKRepository, SESSION_KEY } from '../lib/data/local-repository';
import type { RepositoryEventTarget, RepositoryStorage, RepositoryStorageEvent } from '../lib/data/repository';
import type { Dataset, ManagedAppFields, SubmissionFields } from '../lib/domain/types';
import { validateDataset } from '../lib/data/validation';

const fixture: unknown = JSON.parse(readFileSync(resolve(process.cwd(), 'data.json'), 'utf8'));
const seed = validateDataset(fixture);
const fields: SubmissionFields = { title: 'Automatización local', desc: 'Una descripción suficientemente larga para validar el envío de esta aplicación.', area: 'finanzas', aiTool: 'Demo IA', repoUrl: 'https://example.com/repo' };
const managed: ManagedAppFields = { ...fields, orgId: '#4029', authorId: 'user-marc', hours: 10, users: 2 };
class MemoryStorage implements RepositoryStorage {
  values = new Map<string, string>();
  failSet = false;
  failRemove: string | null = null;
  reads = 0;
  getItem(key: string) { this.reads++; return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failSet) throw new Error('Quota denied'); this.values.set(key, value); }
  removeItem(key: string) { if (this.failRemove === key) { this.failRemove = null; throw new Error('Removal denied'); } this.values.delete(key); }
}
class Events implements RepositoryEventTarget {
  listeners = new Set<(event: RepositoryStorageEvent) => void>();
  addEventListener(_type: 'storage', listener: (event: RepositoryStorageEvent) => void) { this.listeners.add(listener); }
  removeEventListener(_type: 'storage', listener: (event: RepositoryStorageEvent) => void) { this.listeners.delete(listener); }
  dispatch(key: string | null) { for (const listener of this.listeners) listener({ key }); }
}
async function setup(storage = new MemoryStorage(), sessionStorage = new MemoryStorage(), source: unknown = fixture) {
  const events = new Events(); let sequence = 0; let fetches = 0;
  const repository = new LocalBLKRepository({ storage, sessionStorage, eventTarget: events, clock: () => new Date('2026-10-25T10:00:00Z'), uuid: () => `test-${++sequence}`, fetch: async url => { assert.equal(url, '/data.json'); fetches++; return { ok: true, status: 200, json: async () => structuredClone(source) }; } });
  await repository.initialize();
  return { repository, storage, sessionStorage, events, fetches: () => fetches };
}
function saveExternal(storage: MemoryStorage, data: Dataset) { storage.setItem(DATA_KEY, JSON.stringify(data)); }

 test('SSR construction and initial snapshot do not access browser globals', () => {
  const repository = createLocalRepository();
  assert.deepEqual(repository.getSnapshot().apps, []);
  assert.strictEqual(repository.getSnapshot(), repository.getSnapshot());
  assert.equal(repository.getSession(), null);
  repository.destroy();
});

test('baseline fixtures, single initialization, stable immutable snapshots and detached exports', async () => {
  const { repository, storage, sessionStorage, fetches } = await setup();
  await Promise.all([repository.initialize(), repository.initialize()]);
  assert.equal(fetches(), 1);
  const snapshot = repository.getSnapshot();
  assert.equal(snapshot.organizations.length, 6); assert.equal(snapshot.users.length, 21); assert.equal(snapshot.apps.length, 16); assert.equal(snapshot.reviews.length, 13); assert.equal(snapshot.plans.length, 3);
  assert.strictEqual(repository.getSnapshot(), snapshot);
  assert.ok(Object.isFrozen(snapshot.apps[0].metrics));
  assert.throws(() => { snapshot.apps[0].title = 'Mutación'; }, TypeError);
  const exported = repository.exportData(); exported.apps[0].title = 'Detached';
  assert.notEqual(snapshot.apps[0].title, 'Detached');
  assert.equal(storage.getItem(DATA_KEY), null); assert.equal(sessionStorage.getItem(SESSION_KEY), null);
  await assert.rejects(repository.createSubmission(fields), /acceso explícito/);
  await repository.setRole('developer'); assert.strictEqual(repository.getSnapshot(), snapshot);
});

test('explicit identity selectors never use a default session and persist before emitting', async () => {
  const { repository, sessionStorage } = await setup();
  let notifications = 0; repository.subscribe(() => notifications++);
  sessionStorage.failSet = true;
  await assert.rejects(repository.setRole('admin'), /Quota/);
  assert.equal(repository.getSession(), null); assert.equal(notifications, 0);
  sessionStorage.failSet = false;
  const user = await repository.setRole('admin');
  assert.equal(user.id, 'user-vance'); assert.equal(repository.getSession()?.role, 'admin');
  assert.deepEqual(JSON.parse(sessionStorage.getItem(SESSION_KEY)!), repository.getSession());
  sessionStorage.failRemove = SESSION_KEY;
  await assert.rejects(repository.clearSession(), /Removal/); assert.equal(repository.getSession()?.role, 'admin');
  await repository.clearSession(); assert.equal(repository.getSession(), null);
  await assert.rejects(repository.saveBrand(seed.config.brandDefaults), /acceso explícito/);
});

test('submission create, changes requested, version conflict, resubmission, rejection and two-check approval', async () => {
  const { repository } = await setup();
  await repository.setRole('developer');
  const app = await repository.createSubmission({ ...fields, attachments: [{ name: 'data.csv', size: 10, type: 'text/csv' }], generatedHtml: '<h1>Demo</h1>' });
  assert.equal(app.version, 1); assert.equal(app.orgId, '#4029'); assert.equal(app.reviewStatus, 'pending_review'); assert.match(app.ticket, /2026/);
  await assert.rejects(repository.updateSubmission(app.id, fields, 1), /no puede editarse/);
  await repository.setRole('admin');
  await assert.rejects(repository.reviewApp(app.id, 'approved', '', 'Demo', 1), /manualmente/);
  await assert.rejects(repository.reviewApp(app.id, 'approved', '', 'Demo', 1, { security: true, data: false }), /manualmente/);
  await assert.rejects(repository.reviewApp(app.id, 'changes_requested', '', 'Demo', 1), /Motivo/);
  await repository.reviewApp(app.id, 'changes_requested', 'Amplía documentación', '', 1);
  await assert.rejects(repository.reviewApp(app.id, 'rejected', 'Segunda revisión', '', 1), /ya fue revisado/);
  await repository.setRole('developer');
  await assert.rejects(repository.updateSubmission(app.id, fields, 0), /otra pestaña/);
  // Runtime callers cannot bypass the required optimistic version by passing undefined.
  await assert.rejects(repository.updateSubmission(app.id, fields, undefined as unknown as number), /otra pestaña/);
  const updated = await repository.updateSubmission(app.id, { ...fields, generatedHtml: '<h1>V2</h1>' }, 1);
  assert.equal(updated.version, 2); assert.equal(updated.generatedHtml, '<h1>V2</h1>');
  await repository.setRole('admin');
  await assert.rejects(repository.reviewApp(app.id, 'approved', '', 'Demo', 1, { security: true, data: true }), /versión/);
  await repository.reviewApp(app.id, 'approved', '', 'Sandbox DEMO', 2, { security: true, data: true });
  const approved = repository.getSnapshot().apps.find(row => row.id === app.id)!;
  assert.equal(approved.reviewStatus, 'approved'); assert.match(approved.certificate!, /^DEMO-/);
  assert.deepEqual(repository.getSnapshot().reviews[0].checks, { security: true, data: true });
  assert.equal(repository.getSnapshot().reviews.find(row => row.id === 'review-invoice-matcher')?.checks, undefined);
  assert.equal(repository.getSnapshot().events.filter(row => row.appId === app.id).length, 4);
  const other = await repository.saveManagedApp(null, managed);
  await repository.reviewApp(other, 'rejected', 'No cumple', '', 1); assert.equal(repository.getSnapshot().apps.find(row => row.id === other)?.reviewStatus, 'rejected');
});

test('tenant isolation applies to app, profile, user, governance and developer ownership', async () => {
  const { repository } = await setup();
  await repository.setRole('admin', '#1042');
  await assert.rejects(repository.saveManagedApp('invoice-matcher', managed, 1), /otra organización/);
  await assert.rejects(repository.deleteManagedApp('invoice-matcher', 1), /otra organización/);
  await assert.rejects(repository.saveCompanyProfile('#4029', { name: 'Otro tenant' }), /otra organización/);
  await assert.rejects(repository.deleteCompanyProfile('#4029'), /otra organización/);
  await assert.rejects(repository.saveUser(null, { orgId: '#4029', role: 'catalog', name: 'Intruso', email: 'intruso@example.com' }), /otra organización/);
  await assert.rejects(repository.deleteUser('user-marc'), /otra organización/);
  await repository.setRole('developer'); const app = await repository.createSubmission(fields);
  await repository.setRole('admin', '#1042');
  await assert.rejects(repository.reviewApp(app.id, 'changes_requested', 'Intruso', '', 1), /ya fue revisado/);
  await assert.rejects(repository.saveUser(null, { orgId: '#1042', role: 'superadmin', name: 'Escalada', email: 'escalada@example.com' }), /creadores y empleados/);
  await repository.setRole('admin'); const policy = await repository.saveGovernancePolicy(null, { name: 'Privada', enabled: true });
  await repository.setRole('admin', '#1042');
  await assert.rejects(repository.saveGovernancePolicy(policy, { name: 'Ajena', enabled: true }, 1), /organización/);
  await assert.rejects(repository.deleteGovernancePolicy(policy, 1), /organización/);
  await repository.setRole('admin'); await repository.reviewApp(app.id, 'changes_requested', 'Cambios', '', 1);
  await repository.setRole('superadmin');
  await repository.saveUser(null, { orgId: '#1042', role: 'developer', name: 'Otro creador', email: 'other-developer@example.com' });
  await repository.setRole('developer', '#1042');
  await assert.rejects(repository.updateSubmission(app.id, fields, 1), /no puede editarse/);
  await repository.setRole('developer'); await repository.updateSubmission(app.id, fields, 1);
  await repository.setRole('superadmin'); await repository.reviewApp(app.id, 'rejected', 'Decisión global', '', 2);
  assert.equal(repository.getSnapshot().apps.find(row => row.id === app.id)?.reviewStatus, 'rejected');
});

test('cross-tab latest snapshot prevents lost writes and double reviews', async () => {
  const storage = new MemoryStorage(); const a = await setup(storage); const b = await setup(storage);
  await a.repository.setRole('developer'); const app = await a.repository.createSubmission(fields);
  await a.repository.setRole('admin'); await b.repository.setRole('admin');
  await a.repository.reviewApp(app.id, 'approved', '', 'Demo', 1, { security: true, data: true });
  await assert.rejects(b.repository.reviewApp(app.id, 'rejected', 'Duplicada', '', 1), /ya fue revisado/);
  assert.equal(b.repository.getSnapshot().apps.find(row => row.id === app.id)?.reviewStatus, 'pending_review');
  b.events.dispatch(DATA_KEY); assert.equal(b.repository.getSnapshot().apps.length, 17);
  assert.equal(b.repository.getSnapshot().apps.find(row => row.id === app.id)?.reviewStatus, 'approved');
  await b.repository.saveManagedApp(app.id, managed, 1);
  await assert.rejects(a.repository.saveManagedApp(app.id, managed, 1), /versión/);
  a.events.dispatch(DATA_KEY); assert.equal(a.repository.getSnapshot().apps.find(row => row.id === app.id)?.version, 2);
});

test('every mutation revalidates deleted and revoked demo identities without trusting cached roles', async () => {
  const { repository, storage, events, sessionStorage } = await setup();
  await repository.setRole('admin');
  const changed = repository.exportData(); changed.users.find(row => row.id === 'user-vance')!.role = 'catalog'; saveExternal(storage, changed);
  await assert.rejects(repository.saveBrand(seed.config.brandDefaults), /acceso explícito/);
  events.dispatch(DATA_KEY); assert.equal(repository.getSession(), null);
  await repository.reset(); await repository.setRole('catalog');
  const deleted = repository.exportData(); deleted.users = deleted.users.filter(row => row.id !== 'user-employee'); saveExternal(storage, deleted);
  await assert.rejects(repository.createSubmission(fields), /acceso explícito/);
  events.dispatch(DATA_KEY); assert.equal(repository.getSession(), null);
  await repository.reset(); await repository.setRole('admin');
  sessionStorage.removeItem(SESSION_KEY);
  await assert.rejects(repository.saveUser(null, { orgId: '#4029', role: 'catalog', name: 'Sin sesión', email: 'none@example.com' }), /acceso explícito/);
  events.dispatch(SESSION_KEY); assert.equal(repository.getSession(), null);
});

test('suspension blocks tenant access and writes but superadmin can reactivate it', async () => {
  const storage = new MemoryStorage(); const admin = await setup(storage); const superadmin = await setup(storage);
  await admin.repository.setRole('admin'); await superadmin.repository.setRole('superadmin');
  await superadmin.repository.setOrganizationStatus('#4029', 'suspended');
  await assert.rejects(admin.repository.saveBrand(seed.config.brandDefaults), /no está activa/);
  await assert.rejects(admin.repository.setRole('developer'), /no está activa/);
  await superadmin.repository.setOrganizationStatus('#4029', 'active');
  await admin.repository.saveBrand(seed.config.brandDefaults);
});

test('quota failure leaves persisted data, cached snapshot, events and subscribers unchanged', async () => {
  const { repository, storage } = await setup();
  await repository.setRole('developer'); const before = repository.getSnapshot(); const raw = storage.getItem(DATA_KEY); let emits = 0;
  repository.subscribe(() => emits++); storage.failSet = true;
  await assert.rejects(repository.createSubmission(fields), /Quota/);
  assert.strictEqual(repository.getSnapshot(), before); assert.equal(storage.getItem(DATA_KEY), raw); assert.equal(emits, 0);
  storage.failSet = false; const app = await repository.createSubmission(fields); assert.equal(app.version, 1); assert.equal(emits, 1);
});

test('invalid and incompatible local imports never silently reset or overwrite the last valid snapshot', async () => {
  const { repository, storage, events } = await setup();
  const before = repository.getSnapshot(); let emits = 0; repository.subscribe(() => emits++);
  for (const value of ['{bad', '{}', '', JSON.stringify({ ...seed, datasetVersion: 'changed' }), JSON.stringify({ ...seed, apps: seed.apps.concat(seed.apps[0]) })]) {
    storage.setItem(DATA_KEY, value); events.dispatch(DATA_KEY);
    assert.ok(repository.getError()); assert.strictEqual(repository.getSnapshot(), before); assert.equal(storage.getItem(DATA_KEY), value);
    await assert.rejects(repository.setRole('admin'));
  }
  assert.equal(emits, 5); storage.removeItem(DATA_KEY); events.dispatch(DATA_KEY); assert.equal(repository.getError(), null);
  assert.strictEqual(repository.getSnapshot(), before);
});

test('initialize rejects corrupt storage and explicit selective reset recovers with subscriptions', async () => {
  const storage = new MemoryStorage(), sessionStorage = new MemoryStorage(), events = new Events();
  storage.setItem(DATA_KEY, '{invalid'); storage.setItem('studio-layout', 'keep'); storage.setItem('blk_viarapida_css_tokens', 'old'); sessionStorage.setItem(SESSION_KEY, 'old');
  const repository = createLocalRepository({ storage, sessionStorage, eventTarget: events, fetch: async () => ({ ok: true, status: 200, json: async () => fixture }) });
  await assert.rejects(repository.initialize()); assert.ok(repository.getError()); assert.equal(storage.getItem(DATA_KEY), '{invalid');
  await repository.reset(); assert.equal(repository.getSnapshot().apps.length, 16); assert.equal(repository.getSession(), null); assert.equal(repository.getError(), null);
  assert.equal(storage.getItem(DATA_KEY), null); assert.equal(storage.getItem('studio-layout'), 'keep'); assert.equal(storage.getItem('blk_viarapida_css_tokens'), null); assert.equal(events.listeners.size, 1);
});

test('reset rollback preserves selected keys and snapshot on a storage removal failure', async () => {
  const { repository, storage, sessionStorage } = await setup();
  await repository.setRole('developer'); await repository.createSubmission(fields);
  storage.setItem('studio-settings', 'keep'); storage.setItem('blk_viarapida_css_tokens', 'old');
  const before = repository.getSnapshot(), raw = storage.getItem(DATA_KEY), session = sessionStorage.getItem(SESSION_KEY);
  sessionStorage.failRemove = SESSION_KEY;
  await assert.rejects(repository.reset(), /Removal/);
  assert.strictEqual(repository.getSnapshot(), before); assert.equal(storage.getItem(DATA_KEY), raw); assert.equal(sessionStorage.getItem(SESSION_KEY), session);
  await repository.reset(); assert.equal(repository.getSnapshot().revision, 0); assert.equal(repository.getSnapshot().apps.length, 16); assert.equal(storage.getItem('studio-settings'), 'keep');
});

test('organization CRUD validates administrator, members, plans, uniqueness and protected cascades', async () => {
  const { repository } = await setup(); await repository.setRole('superadmin');
  const id = await repository.createOrganization({ name: 'New tenant', email: 'admin@tenant.example', domain: 'tenant.example', plan: 'pro' });
  const org = repository.getSnapshot().organizations.find(row => row.id === id)!;
  assert.equal(org.members, 1); assert.equal(repository.getSnapshot().users.find(row => row.id === org.adminId)?.orgId, id);
  await assert.rejects(repository.createOrganization({ name: 'New tenant', email: 'other@tenant.example', plan: 'pro' }), /ya existe/);
  await assert.rejects(repository.updateOrganization(id, { name: 'New tenant', email: 'admin@tenant.example', plan: 'missing', adminId: org.adminId, members: 1, status: 'active' }), /administrador inválido/);
  await assert.rejects(repository.updateOrganization(id, { name: 'New tenant', email: 'admin@tenant.example', plan: 'pro', adminId: 'user-vance', members: 1, status: 'active' }), /administrador de esta/);
  await assert.rejects(repository.updateOrganization(id, { name: 'New tenant', email: 'admin@tenant.example', plan: 'pro', adminId: org.adminId, members: 0, status: 'active' }), /Miembros/);
  await repository.updateOrganization(id, { name: 'Updated tenant', email: 'admin@updated.example', domain: 'updated.example', plan: 'starter', adminId: org.adminId, members: 2, status: 'active-amber' });
  const author = await repository.saveUser(null, { orgId: id, role: 'developer', name: 'Tenant author', email: 'author@updated.example' });
  const app = await repository.saveManagedApp(null, { ...managed, orgId: id, authorId: author });
  await repository.reviewApp(app, 'approved', '', 'Demo', 1, { security: true, data: true });
  await repository.deleteOrganization(id);
  const data = repository.getSnapshot(); assert.ok(!data.users.some(row => row.orgId === id)); assert.ok(!data.apps.some(row => row.orgId === id)); assert.ok(!data.reviews.some(row => row.appId === app)); assert.ok(!data.events.some(row => row.orgId === id));
  await assert.rejects(repository.deleteOrganization('#4029'), /predeterminada/);
  const protectedTenant = await setup(new MemoryStorage(), new MemoryStorage(), { ...seed, config: { ...seed.config, demoRoles: { ...seed.config.demoRoles, admin: 'user-admin-1042' } } });
  await protectedTenant.repository.setRole('superadmin');
  await assert.rejects(protectedTenant.repository.deleteOrganization('#1042'), /identidades/);
});

test('user CRUD tracks membership and protects linked users, admin relationships and demo identities', async () => {
  const { repository } = await setup(); await repository.setRole('superadmin');
  const initial = repository.getSnapshot().organizations.find(row => row.id === '#4029')!.members;
  const id = await repository.saveUser(null, { orgId: '#4029', role: 'catalog', name: 'Nuevo empleado', email: 'employee@example.com', dept: 'Ops' });
  assert.equal(repository.getSnapshot().organizations.find(row => row.id === '#4029')!.members, initial + 1);
  await repository.saveUser(id, { orgId: '#1042', role: 'developer', name: 'Movido', email: 'employee@example.com' });
  assert.equal(repository.getSnapshot().organizations.find(row => row.id === '#4029')!.members, initial);
  await repository.deleteUser(id); assert.ok(!repository.getSnapshot().users.some(row => row.id === id));
  await assert.rejects(repository.deleteUser('user-marc'), /demostración/);
  await assert.rejects(repository.deleteUser('user-admin-1042'), /administrador/);
  await assert.rejects(repository.deleteUser('user-budget-ai'), /vinculadas/);
  await assert.rejects(repository.saveUser('user-marc', { orgId: '#1042', role: 'developer', name: 'Marc', email: 'marc@example.com' }), /identidad de demo/);
  await assert.rejects(repository.saveUser(null, { orgId: '#4029', role: 'catalog', name: 'Duplicado', email: 'marc@viarapida.demo' }), /correo ya existe/);
});

test('managed app CRUD resets publication and preserves unchanged legacy details with required version', async () => {
  const { repository } = await setup(); await repository.setRole('admin');
  const old = repository.getSnapshot().apps.find(row => row.id === 'invoice-matcher')!;
  await repository.saveManagedApp(old.id, { ...managed, aiTool: undefined, title: old.title, desc: old.desc, area: old.area }, 1);
  const edited = repository.getSnapshot().apps.find(row => row.id === old.id)!;
  assert.equal(edited.version, 2); assert.equal(edited.reviewStatus, 'pending_review'); assert.deepEqual(edited.tech, old.tech); assert.equal(edited.longDesc, old.longDesc); assert.deepEqual(edited.security, []);
  await assert.rejects(repository.saveManagedApp(old.id, managed), /versión/);
  await assert.rejects(repository.deleteManagedApp(old.id, 1), /versión/);
  await repository.deleteManagedApp(old.id, 2); assert.ok(!repository.getSnapshot().reviews.some(row => row.appId === old.id));
  const id = await repository.saveManagedApp(null, managed); await repository.deleteManagedApp(id, 1); assert.ok(!repository.getSnapshot().events.some(row => row.appId === id));
});

test('profiles, brand, global plans/policies and versioned governance policies implement all CRUD', async () => {
  const { repository } = await setup(); await repository.setRole('admin');
  await repository.saveCompanyProfile('#4029', { name: 'Via Rapida', domain: 'viarapida.es', bio: 'Demo bio', bannerTitle: 'Título', bannerDesc: 'Descripción' });
  assert.equal(repository.getSnapshot().organizations[0].profile?.bio, 'Demo bio'); await repository.deleteCompanyProfile('#4029'); assert.equal(repository.getSnapshot().organizations[0].profile, undefined);
  await repository.saveBrand({ ...seed.config.brandDefaults, accent: '#123456' }); assert.equal(repository.getSnapshot().organizations[0].brand?.accent, '#123456');
  await assert.rejects(repository.saveBrand({ ...seed.config.brandDefaults, accent: 'url(javascript:alert(1))' }), /Token/);
  const policy = await repository.saveGovernancePolicy(null, { name: 'Gobernanza', description: 'Local', enabled: true });
  await repository.saveGovernancePolicy(policy, { name: 'Gobernanza V2', enabled: false }, 1);
  await assert.rejects(repository.deleteGovernancePolicy(policy, 1), /otra pestaña/); await repository.deleteGovernancePolicy(policy, 2);
  await assert.rejects(repository.savePlan(null, { name: 'Privilegio', price: 0 }), /rol adecuado/);
  await repository.setRole('superadmin');
  const plan = await repository.savePlan(null, { name: 'Demo plan', price: 5 }); await repository.savePlan(plan, { name: 'Demo plan V2', price: null }); await repository.deletePlan(plan);
  await assert.rejects(repository.deletePlan('enterprise'), /asignado/);
  const global = await repository.savePolicy(null, { name: 'Global', enabled: true }); await repository.savePolicy(global, { name: 'Global V2', description: 'Actualizada', enabled: false }); await repository.deletePolicy(global);
  const scoped = await repository.saveGovernancePolicy(null, { name: 'Scoped', enabled: true }); await assert.rejects(repository.savePolicy(scoped, { name: 'Global', enabled: true }), /global inexistente/); await assert.rejects(repository.deletePolicy(scoped), /global inexistente/);
});

test('validation rejects malformed inputs and broken imported relationships before any publication', async () => {
  const { repository } = await setup(); await repository.setRole('developer'); const snapshot = repository.getSnapshot();
  for (const bad of [{ ...fields, title: '' }, { ...fields, desc: 'short' }, { ...fields, area: 'missing' }, { ...fields, repoUrl: 'javascript:alert(1)' }, { ...fields, attachments: [{ name: 'negative', size: -1, type: '' }] }, { ...fields, attachments: [{ name: 'huge', size: 26214401, type: '' }] }, { ...fields, generatedHtml: 'x'.repeat(300001) }]) await assert.rejects(repository.createSubmission(bad));
  assert.strictEqual(repository.getSnapshot(), snapshot);
  assert.throws(() => validateDataset({ ...seed, users: seed.users.map(user => ({ ...user, orgId: 'missing' })) }), /administrador inválido/);
  assert.throws(() => validateDataset({ ...seed, policies: [{ id: 'bad', name: 'Bad', description: '', enabled: true, orgId: '#4029' }] }), /versión/);
  assert.throws(() => validateDataset({ ...seed, apps: seed.apps.map(app => ({ ...app, authorId: 'missing' })) }), /Relaciones/);
});

test('subscriptions notify updates and storage errors, preserve snapshot on no-op and destroy removes listeners', async () => {
  const { repository, events, storage } = await setup(); let calls = 0;
  const off = repository.subscribe(() => calls++); const before = repository.getSnapshot();
  events.dispatch('studio-settings'); assert.equal(calls, 0);
  events.dispatch(DATA_KEY); assert.equal(calls, 1); assert.strictEqual(repository.getSnapshot(), before);
  await repository.setRole('developer'); assert.equal(calls, 2);
  off(); await repository.createSubmission(fields); assert.equal(calls, 2);
  repository.subscribe(() => calls++); storage.setItem(DATA_KEY, 'broken'); events.dispatch(DATA_KEY); assert.equal(calls, 3); assert.ok(repository.getError());
  repository.destroy(); assert.equal(events.listeners.size, 0); events.dispatch(DATA_KEY); assert.equal(calls, 3);
  await assert.rejects(repository.initialize(), /destruido/); await assert.rejects(repository.createSubmission(fields), /destruido/);
});
