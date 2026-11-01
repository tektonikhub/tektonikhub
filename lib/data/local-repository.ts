import type { App, BrandTokens, CompanyProfileFields, Dataset, DemoSession, ManagedAppFields, OrganizationFields, OrganizationStatus, PlanFields, PolicyFields, ReviewAction, ReviewChecks, Role, SubmissionFields, User, UserFields } from '../domain/types';
import type { BLKRepository, LocalRepositoryOptions, RepositoryStorageEvent } from './repository';
import { safeBrand, submissionFields, text, validateDataset, validateSession } from './validation';

export const DATA_KEY = 'blkunit:demo:v1';
export const SESSION_KEY = 'blkunit:demo-session:v1';
const mutable = ['organizations', 'users', 'apps', 'reviews', 'events', 'plans', 'policies'] as const;
const clone = <T>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

// A stable, empty SSR snapshot; consumers display loading until initialize succeeds.
const EMPTY_DATASET: Dataset = freeze({ schemaVersion: 1, datasetVersion: '', revision: 0,
  config: { defaultOrgId: '#4029', defaultAuthorId: 'user-marc', demoRoles: { developer: 'user-marc', catalog: 'user-employee', admin: 'user-vance', superadmin: 'user-superadmin' }, upload: { maxFiles: 10, maxBytes: 26214400 },
    brandDefaults: { accent: '#FEFF44', bg: '#EFEFEB', card: '#FFFFFF', fg: '#111111', fgSoft: '#444444', line: '#E2E2DE', green: '#0B7A48', amber: '#B45309', displayFont: "'Barlow', system-ui, sans-serif", bodyFont: "'DM Sans', system-ui, sans-serif", rCard: '18px', rSm: '10px' }, brandPresets: {}, statusLabels: { approved: 'Aprobada', pending_review: 'Pendiente de revisión', changes_requested: 'Cambios solicitados', rejected: 'Rechazada' } },
  categories: [], content: {}, organizations: [], users: [], apps: [], reviews: [], events: [], plans: [], policies: [] });

/** Physical local deletes preserve legacy demo parity. Production SQL soft deletion belongs in a future backend adapter. */
export class LocalBLKRepository implements BLKRepository {
  private seed!: Dataset;
  private state: Dataset = EMPTY_DATASET;
  private session: DemoSession | null = null;
  private error: Error | null = null;
  private listeners = new Set<() => void>();
  private initialized = false;
  private destroyed = false;
  private initialization: Promise<void> | null = null;
  private readonly clock: () => Date;
  private readonly uuid: () => string;
  constructor(private readonly options: LocalRepositoryOptions) {
    this.clock = options.clock ?? (() => new Date());
    // No browser/global access until a caller performs an operation.
    this.uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
  }
  private assertReady() { if (!this.initialized || this.destroyed) throw new Error('Repositorio no inicializado o destruido.'); }
  private id(prefix: string) { return `${prefix}-${this.uuid()}`; }
  private now() { return this.clock().toISOString(); }
  private emit() {
    for (const listener of this.listeners) { try { listener(); } catch (error) { this.error = error instanceof Error ? error : new Error(String(error)); } }
  }
  private report(error: unknown) { this.error = error instanceof Error ? error : new Error(String(error)); this.emit(); }
  private latest(): Dataset {
    const raw = this.options.storage.getItem(DATA_KEY);
    if (raw === null) return clone(this.seed);
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Datos guardados inválidos.');
    for (const key of ['schemaVersion', 'datasetVersion', 'revision', ...mutable]) {
      if (!Object.hasOwn(saved, key)) throw new Error(`Falta el campo guardado ${key}. No se han reiniciado los datos.`);
    }
    const data = validateDataset({ ...clone(this.seed), ...saved });
    if (data.datasetVersion !== this.seed.datasetVersion) throw new Error('Los fixtures han cambiado. Reinicia explícitamente la demo.');
    return data;
  }
  private readSession(data: Dataset): DemoSession | null {
    const raw = this.options.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = validateSession(JSON.parse(raw));
    const user = data.users.find(row => row.id === session.userId && row.orgId === session.orgId && row.role === session.role);
    return user ? freeze(session) : null;
  }
  private currentUser(): User {
    this.assertReady();
    const data = this.latest();
    const session = this.readSession(data);
    if (!session) throw new Error('Selecciona una identidad en el acceso explícito de demostración.');
    const user = data.users.find(row => row.id === session.userId);
    if (!user) throw new Error('La identidad ya no existe.');
    if (user.role !== 'superadmin') this.activeOrg(data, user.orgId);
    return user;
  }
  private commit(change: (data: Dataset) => void) {
    this.assertReady();
    const next = this.latest();
    const session = this.readSession(next);
    if (!session) throw new Error('La sesión de demostración ha sido revocada.');
    change(next);
    next.revision++;
    const valid = validateDataset(next);
    const saved = { schemaVersion: valid.schemaVersion, datasetVersion: valid.datasetVersion, revision: valid.revision,
      organizations: valid.organizations, users: valid.users, apps: valid.apps, reviews: valid.reviews, events: valid.events, plans: valid.plans, policies: valid.policies };
    const nextSession = valid.users.some(user => user.id === session.userId && user.orgId === session.orgId && user.role === session.role) ? session : null;
    this.options.storage.setItem(DATA_KEY, JSON.stringify(saved));
    this.publish(valid); this.session = nextSession; this.error = null; this.emit();
  }
  private publish(data: Dataset): void {
    if (!this.state || JSON.stringify(data) !== JSON.stringify(this.state)) this.state = freeze(data);
  }
  private readonly onStorage = (event: RepositoryStorageEvent) => {
    if (!this.initialized || this.destroyed || (event.key !== DATA_KEY && event.key !== SESSION_KEY && event.key !== null)) return;
    try { const next = this.latest(); const session = this.readSession(next); this.publish(next); this.session = session; this.error = null; this.emit(); } catch (error) { this.report(error); }
  };
  initialize(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Repositorio destruido.'));
    if (this.initialized) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.initialization = this.load().catch(error => { this.initialization = null; this.report(error); throw error; });
    return this.initialization;
  }
  private async load() {
    const response = await this.options.fetch('/data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status} al cargar data.json`);
    const seed = validateDataset(await response.json());
    this.seed = freeze(seed);
    const data = this.latest(), session = this.readSession(data);
    if (this.destroyed) throw new Error('Repositorio destruido.');
    this.state = freeze(data); this.session = session; this.initialized = true; this.error = null;
    this.options.eventTarget?.addEventListener('storage', this.onStorage); this.emit();
  }
  getSnapshot(): Dataset { return this.state; }
  getSession(): DemoSession | null { return this.session; }
  getError(): Error | null { return this.error; }
  subscribe(listener: () => void): () => void { if (this.destroyed) throw new Error('Repositorio destruido.'); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  destroy(): void { if (this.initialized) this.options.eventTarget?.removeEventListener('storage', this.onStorage); this.listeners.clear(); this.destroyed = true; }
  exportData(): Dataset { return clone(this.getSnapshot()); }
  async clearSession(): Promise<void> { this.assertReady(); this.options.sessionStorage.removeItem(SESSION_KEY); this.session = null; this.error = null; this.emit(); }
  async setRole(role: Role, orgId?: string): Promise<User> {
    this.assertReady();
    const data = this.latest(), target = orgId ?? this.seed.config.defaultOrgId;
    if (!['developer', 'catalog', 'admin', 'superadmin'].includes(role)) throw new Error('Rol de demo desconocido.');
    if (role !== 'superadmin') this.activeOrg(data, target);
    const configured = data.config.demoRoles[role];
    const user = data.users.find(row => row.id === configured && row.orgId === target && row.role === role) || data.users.find(row => row.role === role && row.orgId === target);
    if (!user) throw new Error('No existe una identidad de demostración para ese rol.');
    const session = { userId: user.id, orgId: user.orgId, role };
    this.options.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.publish(data); this.session = freeze(session); this.error = null; this.emit(); return clone(user);
  }
  async reset(): Promise<void> {
    if (this.destroyed || !this.seed) throw new Error('Carga primero los fixtures.');
    // Roll back all selected keys if any removal fails; never clear unrelated origin data.
    const entries = [[this.options.storage, DATA_KEY], [this.options.sessionStorage, SESSION_KEY], [this.options.storage, 'blk_viarapida_css_tokens']] as const;
    const backup = entries.map(([storage, key]) => storage.getItem(key));
    try { for (const [storage, key] of entries) storage.removeItem(key); }
    catch (error) { for (let i = 0; i < entries.length; i++) { const [storage, key] = entries[i]; const value = backup[i]; if (value !== null && value !== undefined) storage.setItem(key, value); } throw error; }
    this.state = freeze(clone(this.seed)); this.session = null; this.error = null;
    if (!this.initialized) this.options.eventTarget?.addEventListener('storage', this.onStorage);
    this.initialized = true; this.emit();
  }
  private activeOrg(data: Dataset, orgId: string) {
    const org = data.organizations.find(row => row.id === orgId);
    if (!org || ['suspended', 'pending'].includes(org.status)) throw new Error('La organización no está activa.');
    return org;
  }
  private requireRole(...roles: Role[]) {
    const user = this.currentUser();
    if (!roles.includes(user.role)) throw new Error('Selecciona el rol adecuado en el acceso de demostración.');
    return user;
  }
  async createSubmission(fields: SubmissionFields): Promise<App> {
    const user = this.requireRole('developer');
    const values = submissionFields(fields, this.seed);
    const appId = this.id('app');
    const date = this.now();
    this.commit(data => {
      this.activeOrg(data, user.orgId);
      data.apps.push({ id: appId, orgId: user.orgId, authorId: user.id, ticket: `APP-${this.clock().getFullYear()}-${appId.slice(4)}`, ...values, reviewStatus: 'pending_review', maturity: 'new', version: 1, tags: [], security: [], metrics: { hours: 0, users: 0, rating: '—' }, createdAt: date, updatedAt: date });
      data.events.unshift({ id: this.id('event'), orgId: user.orgId, appId, actorId: user.id, action: 'submitted', createdAt: date });
    });
    return clone(this.state.apps.find(app => app.id === appId)!);
  }
  async updateSubmission(appId: string, fields: SubmissionFields, expectedVersion: number): Promise<App> {
    const user = this.requireRole('developer');
    const values = submissionFields(fields, this.seed);
    this.commit(data => {
      const app = data.apps.find(row => row.id === appId);
      if (!app || app.authorId !== user.id || app.reviewStatus !== 'changes_requested' || app.version !== expectedVersion) throw new Error('Este envío no puede editarse o ha cambiado en otra pestaña.');
      this.activeOrg(data, app.orgId);
      Object.assign(app, values, { reviewStatus: 'pending_review', version: app.version + 1, updatedAt: this.now() });
      data.events.unshift({ id: this.id('event'), orgId: app.orgId, appId, actorId: user.id, action: 'resubmitted', createdAt: this.now() });
    });
    return clone(this.state.apps.find(app => app.id === appId)!);
  }
  async reviewApp(appId: string, action: ReviewAction, reason: string, environment: string, expectedVersion: number, checks?: ReviewChecks) {
    const user = this.requireRole('admin', 'superadmin');
    if (!['approved', 'rejected', 'changes_requested'].includes(action)) throw new Error('Decisión desconocida.');
    const note = text(reason, 3000, 'Motivo', action === 'approved' ? 0 : 1);
    const checkedEnvironment = text(environment, 200, 'Entorno');
    if (action === 'approved' && (checks?.security !== true || checks?.data !== true)) throw new Error('Confirma manualmente las comprobaciones de seguridad y datos.');
    this.commit(data => {
      const app = data.apps.find(row => row.id === appId);
      if (!app || app.reviewStatus !== 'pending_review' || (user.role !== 'superadmin' && app.orgId !== user.orgId) || app.version !== expectedVersion) throw new Error('El envío ya fue revisado o cambió de versión.');
      this.activeOrg(data, app.orgId);
      const date = this.now();
      const reviewId = this.id('review');
      app.reviewStatus = action;
      app.updatedAt = date;
      if (action === 'approved') { app.security = ['Revisión interna DEMO']; app.environment = text(environment, 200, 'Entorno'); app.certificate = `DEMO-${reviewId.slice(7)}`; }
      data.reviews.unshift({ id: reviewId, appId, reviewerId: user.id, action, reason: note, environment: checkedEnvironment, version: app.version, createdAt: date, ...(action === 'approved' ? { checks: { security: true, data: true } } : {}) });
      data.events.unshift({ id: this.id('event'), orgId: app.orgId, appId, actorId: user.id, action, createdAt: date });
    });
  }
  async createOrganization(fields: OrganizationFields) {
    this.requireRole('superadmin');
    const name = text(fields.name, 120, 'Organización', 1);
    const email = text(fields.email, 254, 'Email', 3);
    const domain = text(fields.domain || '', 253, 'Dominio');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido.');
    if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new Error('Dominio no válido.');
    const orgId = this.id('org'), adminId = this.id('user');
    this.commit(data => {
      if (!data.plans.some(plan => plan.id === fields.plan)) throw new Error('Plan no válido.');
      if (data.organizations.some(org => org.name.toLowerCase() === name.toLowerCase() || (domain && org.domain?.toLowerCase() === domain.toLowerCase()))) throw new Error('La organización ya existe.');
      if (data.users.some(user => user.email?.toLowerCase() === email.toLowerCase())) throw new Error('El correo ya existe.');
      data.users.push({ id: adminId, orgId, name: email, email, initials: name.slice(0, 2).toUpperCase(), dept: 'Administración', role: 'admin' });
      data.organizations.push({ id: orgId, name, initials: name.slice(0, 2).toUpperCase(), plan: fields.plan, members: 1, compliance: null, status: 'active', adminId, createdAt: this.now(), date: this.clock().toLocaleDateString('es-ES'), domain, lastAccess: 'Demo local', brand: clone(this.seed.config.brandDefaults) });
      data.events.unshift({ id: this.id('event'), orgId, actorId: this.currentUser().id, action: 'organization_created', createdAt: this.now() });
    });
    return orgId;
  }
  async setOrganizationStatus(orgId: string, status: OrganizationStatus) {
    const user = this.requireRole('superadmin');
    if (!['active', 'suspended'].includes(status)) throw new Error('Estado no válido.');
    this.commit(data => {
      const org = data.organizations.find(row => row.id === orgId);
      if (!org) throw new Error('Organización inexistente.');
      org.status = status;
      data.events.unshift({ id: this.id('event'), orgId, actorId: user.id, action: `organization_${status}`, createdAt: this.now() });
    });
  }
  private emailField(value: string) {
    const email = text(value, 254, 'Email', 3);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido.');
    return email;
  }
  async updateOrganization(orgId: string, fields: OrganizationFields) {
    this.requireRole('superadmin');
    this.commit(data => {
      const org = data.organizations.find(row => row.id === orgId);
      if (!org) throw new Error('Organización inexistente.');
      const name = text(fields.name, 120, 'Organización', 1);
      const domain = text(fields.domain || '', 253, 'Dominio');
      if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new Error('Dominio no válido.');
      if (data.organizations.some(row => row.id !== orgId && (row.name.toLowerCase() === name.toLowerCase() || (domain && row.domain?.toLowerCase() === domain.toLowerCase())))) throw new Error('La organización ya existe.');
      const admin = data.users.find(row => row.id === fields.adminId && row.orgId === orgId && ['admin', 'superadmin'].includes(row.role));
      if (!admin) throw new Error('Selecciona un administrador de esta organización.');
      if (fields.members === undefined || !Number.isSafeInteger(fields.members) || fields.members < data.users.filter(row => row.orgId === orgId).length) throw new Error('Miembros debe ser un entero igual o mayor que los usuarios registrados.');
      const email = this.emailField(fields.email);
      if (data.users.some(row => row.id !== admin.id && row.email?.toLowerCase() === email.toLowerCase())) throw new Error('El correo ya existe.');
      Object.assign(org, { name, domain, plan: fields.plan, status: fields.status, members: fields.members, adminId: admin.id, initials: name.slice(0, 2).toUpperCase() });
      admin.email = email;
    });
  }
  async deleteOrganization(orgId: string) {
    const actor = this.requireRole('superadmin');
    this.commit(data => {
      if (orgId === this.seed.config.defaultOrgId || orgId === actor.orgId) throw new Error('No puedes eliminar la organización predeterminada o la de tu sesión.');
      if (!data.organizations.some(row => row.id === orgId)) throw new Error('Organización inexistente.');
      const userIds = new Set(data.users.filter(row => row.orgId === orgId).map(row => row.id));
      if (Object.values(this.seed.config.demoRoles).some(userId => userIds.has(userId))) throw new Error('La organización contiene identidades de demostración protegidas.');
      const appIds = new Set(data.apps.filter(row => row.orgId === orgId).map(row => row.id));
      data.organizations = data.organizations.filter(row => row.id !== orgId);
      data.policies = data.policies.filter(row => row.orgId !== orgId);
      data.users = data.users.filter(row => !userIds.has(row.id));
      data.apps = data.apps.filter(row => !appIds.has(row.id));
      data.reviews = data.reviews.filter(row => (row.appId === undefined || !appIds.has(row.appId)) && !userIds.has(row.reviewerId));
      data.events = data.events.filter(row => row.orgId !== orgId && (row.appId === undefined || !appIds.has(row.appId)) && !userIds.has(row.actorId));
    });
  }
  private managedOrg(data: Dataset, orgId: string, actor: User) {
    if (actor.role !== 'superadmin' && orgId !== actor.orgId) throw new Error('No puedes gestionar otra organización.');
    return this.activeOrg(data, orgId);
  }
  async saveCompanyProfile(orgId: string, fields: CompanyProfileFields) {
    const actor = this.requireRole('admin', 'superadmin');
    this.commit(data => {
      const org = this.managedOrg(data, orgId, actor);
      const name = text(fields.name, 120, 'Organización', 1);
      const domain = text(fields.domain || '', 253, 'Dominio');
      if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new Error('Dominio no válido.');
      if (data.organizations.some(row => row.id !== orgId && (row.name.toLowerCase() === name.toLowerCase() || (domain && row.domain?.toLowerCase() === domain.toLowerCase())))) throw new Error('La organización ya existe.');
      org.name = name; org.domain = domain;
      org.initials = name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
      org.profile = { bio: text(fields.bio || '', 2000, 'Descripción'), bannerTitle: text(fields.bannerTitle || '', 160, 'Título del banner'), bannerDesc: text(fields.bannerDesc || '', 2000, 'Descripción del banner') };
    });
  }
  async deleteCompanyProfile(orgId: string) {
    const actor = this.requireRole('admin', 'superadmin');
    this.commit(data => { delete this.managedOrg(data, orgId, actor).profile; });
  }
  async saveManagedApp(appId: string | null, fields: ManagedAppFields, expectedVersion?: number) {
    const actor = this.requireRole('admin', 'superadmin');
    const values = submissionFields(fields, this.seed), recordId = appId || this.id('app');
    const hours = fields.hours, users = fields.users;
    if (!Number.isSafeInteger(hours) || hours < 0 || !Number.isSafeInteger(users) || users < 0) throw new Error('Horas y usuarios deben ser enteros no negativos.');
    this.commit(data => {
      const existing = appId ? data.apps.find(row => row.id === appId) : null;
      if (appId && !existing) throw new Error('Aplicación inexistente.');
      const orgId = existing?.orgId || fields.orgId;
      this.managedOrg(data, orgId, actor);
      if (existing && expectedVersion !== existing.version) throw new Error('La aplicación cambió de versión. Recarga el formulario.');
      const author = data.users.find(row => row.id === fields.authorId && row.orgId === orgId && row.role === 'developer');
      if (!author) throw new Error('Selecciona un creador de esta organización.');
      const date = this.now();
      const app: App = existing || { id: recordId, orgId, authorId: author.id, ticket: `DEMO-${recordId}`, tags: [], createdAt: date, updatedAt: date, version: 0, ...values, metrics: { hours, users, rating: '—' }, security: [], reviewStatus: 'pending_review', maturity: 'new' };
      const longDesc = existing && existing.desc === values.desc ? (existing.longDesc || values.desc) : values.desc;
      const tech = fields.aiTool === undefined && existing ? existing.tech : [...values.tech, ...(existing?.tech?.slice(1) || [])];
      const attachments = fields.attachments === undefined && existing ? existing.attachments : values.attachments;
      Object.assign(app, values, { longDesc, tech, attachments, authorId: author.id, metrics: { hours, users, rating: existing?.metrics?.rating || '—' }, security: [], reviewStatus: 'pending_review', maturity: 'new', version: app.version + 1, updatedAt: date });
      delete app.certificate; delete app.environment;
      if (!existing) data.apps.push(app);
      data.events.unshift({ id: this.id('event'), orgId, appId: recordId, actorId: actor.id, action: existing ? 'resubmitted' : 'submitted', createdAt: date });
    });
    return recordId;
  }
  async deleteManagedApp(appId: string, expectedVersion: number) {
    const actor = this.requireRole('admin', 'superadmin');
    this.commit(data => {
      const app = data.apps.find(row => row.id === appId);
      if (!app) throw new Error('Aplicación inexistente.');
      this.managedOrg(data, app.orgId, actor);
      if (expectedVersion !== app.version) throw new Error('La aplicación cambió de versión.');
      data.apps = data.apps.filter(row => row.id !== appId);
      data.reviews = data.reviews.filter(row => row.appId !== appId);
      data.events = data.events.filter(row => row.appId !== appId);
    });
  }
  async saveUser(userId: string | null, fields: UserFields) {
    const actor = this.requireRole('admin', 'superadmin');
    const recordId = userId || this.id('user');
    this.commit(data => {
      const existing = userId ? data.users.find(row => row.id === userId) : null;
      if (userId && !existing) throw new Error('Usuario inexistente.');
      if (actor.role !== 'superadmin') {
        this.managedOrg(data, fields.orgId, actor);
        if ((existing && (existing.orgId !== actor.orgId || !['developer', 'catalog'].includes(existing.role))) || !['developer', 'catalog'].includes(fields.role)) throw new Error('Solo puedes gestionar creadores y empleados de tu organización.');
      }
      const name = text(fields.name, 120, 'Nombre', 1), email = this.emailField(fields.email);
      if (data.users.some(row => row.id !== recordId && row.email?.toLowerCase() === email.toLowerCase())) throw new Error('El correo ya existe.');
      const org = data.organizations.find(row => row.id === fields.orgId);
      if (!org) throw new Error('Organización inexistente.');
      if (!['developer', 'catalog', 'admin', 'superadmin'].includes(fields.role)) throw new Error('Rol inválido.');
      if (existing && (existing.orgId !== fields.orgId || existing.role !== fields.role)) {
        if (existing.id === actor.id || Object.values(this.seed.config.demoRoles).includes(existing.id)) throw new Error('No puedes cambiar el rol u organización de una identidad de demo o de tu sesión.');
        if (data.organizations.some(row => row.adminId === userId) && (existing.orgId !== fields.orgId || !['admin', 'superadmin'].includes(fields.role))) throw new Error('Asigna otro administrador a la organización antes de cambiar este usuario.');
        if (existing.orgId !== fields.orgId && data.apps.some(row => row.authorId === userId)) throw new Error('El usuario tiene aplicaciones en su organización.');
      }
      const values = { name, email, orgId: org.id, role: fields.role, dept: text(fields.dept || '', 120, 'Departamento'), initials: name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() };
      if (existing) {
        if (existing.orgId !== org.id) data.organizations.find(row => row.id === existing.orgId)!.members--;
        if (existing.orgId !== org.id) org.members++;
        Object.assign(existing, values);
      } else { data.users.push({ id: recordId, ...values }); org.members++; }
    });
    return recordId;
  }
  async deleteUser(userId: string) {
    const actor = this.requireRole('admin', 'superadmin');
    this.commit(data => {
      const user = data.users.find(row => row.id === userId);
      if (!user) throw new Error('Usuario inexistente.');
      if (actor.role !== 'superadmin') {
        this.managedOrg(data, user.orgId, actor);
        if (!['developer', 'catalog'].includes(user.role)) throw new Error('Solo puedes gestionar creadores y empleados de tu organización.');
      }
      if (userId === actor.id || Object.values(this.seed.config.demoRoles).includes(userId)) throw new Error('No puedes eliminar tu sesión ni identidades de demostración.');
      if (data.organizations.some(row => row.adminId === userId)) throw new Error('Asigna otro administrador antes de eliminar este usuario.');
      if (data.apps.some(row => row.authorId === userId) || data.reviews.some(row => row.reviewerId === userId)) throw new Error('El usuario tiene aplicaciones o revisiones vinculadas.');
      data.users = data.users.filter(row => row.id !== userId);
      data.events = data.events.filter(row => row.actorId !== userId);
      data.organizations.find(row => row.id === user.orgId)!.members--;
    });
  }
  async inviteUser(userId: string): Promise<void> { void userId; throw new Error('Las invitaciones requieren el backend real.'); }
  async setUserEnabled(userId: string, enabled: boolean): Promise<void> { void userId; void enabled; throw new Error('La gestión de acceso requiere el backend real.'); }
  async savePlan(planId: string | null, fields: PlanFields) {
    this.requireRole('superadmin');
    const recordId = planId || this.id('plan');
    this.commit(data => {
      const name = text(fields.name, 100, 'Plan', 1);
      if (data.plans.some(row => row.id !== recordId && row.name.toLowerCase() === name.toLowerCase())) throw new Error('El plan ya existe.');
      if (fields.price !== null && (!Number.isFinite(fields.price) || fields.price < 0)) throw new Error('Precio inválido.');
      const plan = data.plans.find(row => row.id === planId);
      if (planId && !plan) throw new Error('Plan inexistente.');
      if (plan) Object.assign(plan, { name, price: fields.price });
      else data.plans.push({ id: recordId, name, price: fields.price });
    });
    return recordId;
  }
  async deletePlan(planId: string) {
    this.requireRole('superadmin');
    this.commit(data => {
      if (!data.plans.some(row => row.id === planId)) throw new Error('Plan inexistente.');
      if (data.organizations.some(row => row.plan === planId)) throw new Error('El plan está asignado a organizaciones. Cambia sus planes antes de eliminarlo.');
      data.plans = data.plans.filter(row => row.id !== planId);
    });
  }
  async savePolicy(policyId: string | null, fields: PolicyFields) {
    this.requireRole('superadmin');
    const recordId = policyId || this.id('policy');
    this.commit(data => {
      const values = { name: text(fields.name, 120, 'Política', 1), description: text(fields.description || '', 3000, 'Descripción'), enabled: fields.enabled === true };
      const policy = data.policies.find(row => row.id === policyId);
      if (policyId && (!policy || policy.orgId !== undefined)) throw new Error('Política global inexistente.');
      if (policy) Object.assign(policy, values); else data.policies.push({ id: recordId, ...values });
    });
    return recordId;
  }
  async deletePolicy(policyId: string) {
    this.requireRole('superadmin');
    this.commit(data => {
      if (!data.policies.some(row => row.id === policyId && row.orgId === undefined)) throw new Error('Política global inexistente.');
      data.policies = data.policies.filter(row => row.id !== policyId);
    });
  }
  async saveGovernancePolicy(policyId: string | null, fields: PolicyFields, expectedVersion?: number) {
    const actor = this.requireRole('admin', 'superadmin');
    const recordId = policyId || this.id('policy');
    const values = { name: text(fields.name, 120, 'Política', 1), description: text(fields.description || '', 3000, 'Descripción'), enabled: fields.enabled === true };
    this.commit(data => {
      this.managedOrg(data, actor.orgId, actor);
      const policy = data.policies.find(row => row.id === policyId);
      if (policyId && (!policy || policy.orgId !== actor.orgId)) throw new Error('Solo puedes editar políticas de tu organización.');
      if (policy && policy.version !== expectedVersion) throw new Error('La política cambió en otra pestaña. Recarga el formulario.');
      if (policy) Object.assign(policy, values, { version: policy.version! + 1, updatedAt: this.now() });
      else data.policies.push({ id: recordId, orgId: actor.orgId, ...values, version: 1, createdAt: this.now(), updatedAt: this.now() });
    });
    return recordId;
  }
  async deleteGovernancePolicy(policyId: string, expectedVersion: number) {
    const actor = this.requireRole('admin', 'superadmin');
    this.commit(data => {
      this.managedOrg(data, actor.orgId, actor);
      const policy = data.policies.find(row => row.id === policyId);
      if (!policy || policy.orgId !== actor.orgId) throw new Error('Solo puedes eliminar políticas de tu organización.');
      if (policy.version !== expectedVersion) throw new Error('La política cambió en otra pestaña.');
      data.policies = data.policies.filter(row => row.id !== policyId);
    });
  }
  async saveBrand(tokens: BrandTokens) {
    const user = this.requireRole('admin', 'superadmin');
    const values = safeBrand(tokens);
    this.commit(data => { this.activeOrg(data, user.orgId).brand = values; });
  }
}

/** Factory creation and getSnapshot are SSR-safe: browser dependencies resolve only when used. */
export function createLocalRepository(options?: LocalRepositoryOptions): LocalBLKRepository {
  return new LocalBLKRepository(options ?? {
    storage: { getItem: key => globalThis.localStorage.getItem(key), setItem: (key, value) => globalThis.localStorage.setItem(key, value), removeItem: key => globalThis.localStorage.removeItem(key) },
    sessionStorage: { getItem: key => globalThis.sessionStorage.getItem(key), setItem: (key, value) => globalThis.sessionStorage.setItem(key, value), removeItem: key => globalThis.sessionStorage.removeItem(key) },
    eventTarget: { addEventListener: (type, listener) => globalThis.addEventListener(type, listener), removeEventListener: (type, listener) => globalThis.removeEventListener(type, listener) },
    fetch: url => globalThis.fetch(url)
  });
}
