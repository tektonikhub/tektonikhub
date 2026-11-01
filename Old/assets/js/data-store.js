(() => {
  'use strict';
  const KEY = 'blkunit:demo:v1';
  const SESSION_KEY = 'blkunit:demo-session:v1';
  const listeners = new Set();
  const copy = value => JSON.parse(JSON.stringify(value));
  let seed, state, session = null;
  const mutable = ['organizations', 'users', 'apps', 'reviews', 'events', 'plans', 'policies'];
  const pageNames = { 'index.html': 'index', 'company-profile.html': 'companyProfile', 'profile.html': 'profile', 'app-catalog.html': 'catalog', 'create-app.html': 'creator', 'admin.html': 'admin', 'super-admin.html': 'superAdmin', 'login.html': 'login' };
  const id = prefix => `${prefix}-${crypto.randomUUID()}`;
  const now = () => new Date().toISOString();
  const text = (value, max, label, min = 0) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error(`${label}: longitud no válida (${min}–${max}).`);
    return value.trim();
  };
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || !Number.isInteger(data.revision) || data.revision < 0) throw new Error('Versión de datos no compatible.');
    for (const name of mutable) {
      if (!Array.isArray(data[name])) throw new Error(`Falta la colección ${name}.`);
      const ids = data[name].map(row => row.id);
      if (ids.some(value => typeof value !== 'string' || !/^[a-zA-Z0-9#_-]+$/.test(value)) || new Set(ids).size !== ids.length) throw new Error(`Identificadores inválidos en ${name}.`);
    }
    const planIds = new Set(data.plans.map(row => row.id));
    for (const plan of data.plans) if (typeof plan.name !== 'string' || !plan.name.trim() || (plan.price !== null && (!Number.isFinite(plan.price) || plan.price < 0))) throw new Error('Plan inválido.');
    for (const policy of data.policies) if (typeof policy.name !== 'string' || !policy.name.trim() || typeof policy.description !== 'string' || typeof policy.enabled !== 'boolean') throw new Error('Política inválida.');
    const orgIds = new Set(data.organizations.map(row => row.id));
    for (const policy of data.policies) if (policy.orgId !== undefined && (!orgIds.has(policy.orgId) || !Number.isInteger(policy.version) || policy.version < 1)) throw new Error('Ámbito o versión de política inválidos.');
    const users = new Map(data.users.map(row => [row.id, row]));
    const apps = new Map(data.apps.map(row => [row.id, row]));
    for (const org of data.organizations) {
      if (!planIds.has(org.plan) || !users.has(org.adminId) || users.get(org.adminId).orgId !== org.id || !['admin', 'superadmin'].includes(users.get(org.adminId).role) || !['active', 'active-amber', 'suspended', 'pending'].includes(org.status)) throw new Error('Organización o administrador inválido.');
      if (typeof org.name !== 'string' || !Number.isFinite(org.members) || org.members < 0) throw new Error('Datos de organización inválidos.');
      if (org.profile !== undefined) {
        if (!org.profile || typeof org.profile !== 'object') throw new Error('Perfil de organización inválido.');
        text(org.profile.bio, 2000, 'Descripción'); text(org.profile.bannerTitle, 160, 'Título del banner'); text(org.profile.bannerDesc, 2000, 'Descripción del banner');
      }
    }
    for (const user of data.users) if (!orgIds.has(user.orgId) || !['developer', 'catalog', 'admin', 'superadmin'].includes(user.role)) throw new Error('Usuario o rol inválido.');
    for (const app of data.apps) {
      if (!orgIds.has(app.orgId) || !users.has(app.authorId) || users.get(app.authorId).orgId !== app.orgId) throw new Error('Relaciones de aplicación inválidas.');
      if (!['pending_review', 'changes_requested', 'rejected', 'approved'].includes(app.reviewStatus) || !Number.isInteger(app.version) || app.version < 1 || typeof app.title !== 'string' || typeof app.desc !== 'string') throw new Error('Aplicación inválida.');
      if (!Array.isArray(app.attachments) || !Array.isArray(app.tech) || !Array.isArray(app.tags) || !Array.isArray(app.security)) throw new Error('Metadatos de aplicación inválidos.');
      if (app.generatedHtml !== undefined && (typeof app.generatedHtml !== 'string' || app.generatedHtml.length > 300000)) throw new Error('HTML generado inválido.');
    }
    for (const review of data.reviews) if (!apps.has(review.appId) || !users.has(review.reviewerId) || !['approved', 'rejected', 'changes_requested'].includes(review.action)) throw new Error('Revisión inválida.');
    return data;
  }
  function latest() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return copy(seed);
    const saved = validate({ ...copy(seed), ...JSON.parse(raw) });
    if (saved.datasetVersion !== seed.datasetVersion) throw new Error('Los fixtures han cambiado. Reinicia la demo para usar la nueva versión.');
    return { ...copy(seed), ...saved };
  }
  function emit() {
    for (const callback of listeners) { try { callback(); } catch (error) { showError(error); } }
    applyBrand();
  }
  function commit(change) {
    const next = latest();
    change(next);
    next.revision++;
    validate(next);
    const saved = { schemaVersion: next.schemaVersion, datasetVersion: next.datasetVersion, revision: next.revision };
    mutable.forEach(name => { saved[name] = next[name]; });
    // Persist before publishing: a quota/permission failure must not look like a successful save.
    localStorage.setItem(KEY, JSON.stringify(saved));
    state = next;
    emit();
  }
  function currentOrg() { return copy(state.organizations.find(org => org.id === (session?.orgId || seed.config.defaultOrgId)) || state.organizations.find(org => org.id === seed.config.defaultOrgId)); }
  function currentUser() { return copy(state.users.find(user => user.id === session?.userId) || state.users.find(user => user.id === seed.config.defaultAuthorId)); }
  function activeOrg(data, orgId) {
    const org = data.organizations.find(row => row.id === orgId);
    if (!org || ['suspended', 'pending'].includes(org.status)) throw new Error('La organización no está activa.');
    return org;
  }
  function requireRole(...roles) {
    const user = currentUser();
    if (!roles.includes(user.role)) throw new Error('Selecciona el rol adecuado en el acceso de demostración.');
    return user;
  }
  function setRole(role, orgId = seed.config.defaultOrgId) {
    if (!['developer', 'catalog', 'admin', 'superadmin'].includes(role)) throw new Error('Rol de demo desconocido.');
    if (role !== 'superadmin') activeOrg(state, orgId);
    const configuredId = seed.config.demoRoles[role];
    const user = state.users.find(row => row.id === configuredId && row.orgId === orgId) || state.users.find(row => row.role === role && row.orgId === orgId);
    if (!user) throw new Error('No existe una identidad de demostración para ese rol.');
    const next = { userId: user.id, orgId: user.orgId, role };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    session = next;
    emit();
    return copy(user);
  }
  function apps({ orgId = currentOrg().id, authorId, includeUnpublished = false } = {}) {
    return copy(state.apps.filter(app => app.orgId === orgId && (!authorId || app.authorId === authorId) && (includeUnpublished || app.reviewStatus === 'approved')));
  }
  function catalogApp(app) {
    const author = state.users.find(user => user.id === app.authorId);
    const category = seed.categories.find(row => row.id === app.area);
    return { ...copy(app), status: app.maturity || 'approved', areaLabel: category?.label || app.area, author: { initials: author.initials, name: author.name, dept: author.dept }, metrics: { hours: `${Number(app.metrics?.hours || 0).toLocaleString('es-ES')}h`, users: app.metrics?.users || 0, rating: app.metrics?.rating || '—' } };
  }
  function catalogApps() {
    if (['suspended', 'pending'].includes(currentOrg().status)) return [];
    return apps().map(catalogApp);
  }
  function submissionFields(fields) {
    const title = text(fields.title, 60, 'Título', 1);
    const desc = text(fields.desc, 800, 'Descripción', 30);
    if (!seed.categories.some(row => row.id === fields.area)) throw new Error('Selecciona una categoría válida.');
    const attachments = fields.attachments || [];
    if (!Array.isArray(attachments) || attachments.length > seed.config.upload.maxFiles) throw new Error('Demasiados adjuntos.');
    let total = 0;
    const metadata = attachments.map(file => {
      if (!Number.isFinite(file.size) || file.size < 0) throw new Error('Tamaño de adjunto inválido.');
      total += file.size;
      return { name: text(file.name, 255, 'Nombre de archivo', 1), size: file.size, type: text(file.type || '', 128, 'Tipo') };
    });
    if (total > seed.config.upload.maxBytes) throw new Error('El tamaño total supera el límite de adjuntos.');
    const repoUrl = text(fields.repoUrl || '', 1000, 'URL');
    if (repoUrl) { let url; try { url = new URL(repoUrl); } catch { throw new Error('Introduce una URL válida.'); } if (!['https:', 'http:'].includes(url.protocol)) throw new Error('La URL debe usar HTTP o HTTPS.'); }
    const generated = fields.generatedHtml === undefined ? {} : { generatedHtml: text(fields.generatedHtml, 300000, 'HTML generado') };
    return { title, desc, area: fields.area, tagline: text(fields.tagline || '', 100, 'Resumen'), impact: text(fields.impact || '', 500, 'Impacto'), dataNote: text(fields.dataNote || '', 2000, 'Nota de datos'), repoUrl, tech: fields.aiTool ? [text(fields.aiTool, 100, 'Herramienta IA')] : [], attachments: metadata, ...generated };
  }
  function createSubmission(fields) {
    const user = requireRole('developer');
    const values = submissionFields(fields);
    const appId = id('app');
    const date = now();
    commit(data => {
      activeOrg(data, user.orgId);
      data.apps.push({ id: appId, orgId: user.orgId, authorId: user.id, ticket: `APP-${new Date().getFullYear()}-${appId.slice(4)}`, ...values, reviewStatus: 'pending_review', maturity: 'new', version: 1, tags: [], security: [], metrics: { hours: 0, users: 0, rating: '—' }, createdAt: date, updatedAt: date });
      data.events.unshift({ id: id('event'), orgId: user.orgId, appId, actorId: user.id, action: 'submitted', createdAt: date });
    });
    return copy(state.apps.find(app => app.id === appId));
  }
  function updateSubmission(appId, fields, expectedVersion) {
    const user = requireRole('developer');
    const values = submissionFields(fields);
    commit(data => {
      const app = data.apps.find(row => row.id === appId);
      if (!app || app.authorId !== user.id || app.reviewStatus !== 'changes_requested' || (expectedVersion != null && app.version !== expectedVersion)) throw new Error('Este envío no puede editarse o ha cambiado en otra pestaña.');
      activeOrg(data, app.orgId);
      Object.assign(app, values, { reviewStatus: 'pending_review', version: app.version + 1, updatedAt: now() });
      data.events.unshift({ id: id('event'), orgId: app.orgId, appId, actorId: user.id, action: 'resubmitted', createdAt: now() });
    });
    return copy(state.apps.find(app => app.id === appId));
  }
  function reviewApp(appId, action, reason = '', environment = '', expectedVersion) {
    const user = requireRole('admin', 'superadmin');
    if (!['approved', 'rejected', 'changes_requested'].includes(action)) throw new Error('Decisión desconocida.');
    const note = text(reason, 3000, 'Motivo', action === 'approved' ? 0 : 1);
    commit(data => {
      const app = data.apps.find(row => row.id === appId);
      if (!app || app.reviewStatus !== 'pending_review' || (user.role !== 'superadmin' && app.orgId !== user.orgId) || (expectedVersion != null && app.version !== expectedVersion)) throw new Error('El envío ya fue revisado o cambió de versión.');
      activeOrg(data, app.orgId);
      const date = now();
      const reviewId = id('review');
      app.reviewStatus = action;
      app.updatedAt = date;
      if (action === 'approved') { app.security = ['Revisión interna DEMO']; app.environment = text(environment, 200, 'Entorno'); app.certificate = `DEMO-${reviewId.slice(7)}`; }
      data.reviews.unshift({ id: reviewId, appId, reviewerId: user.id, action, reason: note, environment, version: app.version, createdAt: date });
      data.events.unshift({ id: id('event'), orgId: app.orgId, appId, actorId: user.id, action, createdAt: date });
    });
  }
  function organizations() {
    return copy(state.organizations.map(org => ({ ...org, apps: state.apps.filter(app => app.orgId === org.id && app.reviewStatus === 'approved').length, pending: state.apps.filter(app => app.orgId === org.id && app.reviewStatus === 'pending_review').length, admin: state.users.find(user => user.id === org.adminId) })));
  }
  function createOrganization(fields) {
    requireRole('superadmin');
    const name = text(fields.name, 120, 'Organización', 1);
    const email = text(fields.email, 254, 'Email', 3);
    const domain = text(fields.domain || '', 253, 'Dominio');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido.');
    if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new Error('Dominio no válido.');
    if (!state.plans.some(plan => plan.id === fields.plan)) throw new Error('Plan no válido.');
    const orgId = id('org'), adminId = id('user');
    commit(data => {
      if (data.organizations.some(org => org.name.toLowerCase() === name.toLowerCase() || (domain && org.domain?.toLowerCase() === domain.toLowerCase()))) throw new Error('La organización ya existe.');
      if (data.users.some(user => user.email?.toLowerCase() === email.toLowerCase())) throw new Error('El correo ya existe.');
      data.users.push({ id: adminId, orgId, name: email, email, initials: name.slice(0, 2).toUpperCase(), dept: 'Administración', role: 'admin' });
      data.organizations.push({ id: orgId, name, initials: name.slice(0, 2).toUpperCase(), plan: fields.plan, members: 1, compliance: null, status: 'active', adminId, createdAt: now(), date: new Date().toLocaleDateString('es-ES'), domain, lastAccess: 'Demo local', brand: copy(seed.config.brandDefaults) });
      data.events.unshift({ id: id('event'), orgId, actorId: currentUser().id, action: 'organization_created', createdAt: now() });
    });
    return orgId;
  }
  function setOrganizationStatus(orgId, status) {
    const user = requireRole('superadmin');
    if (!['active', 'suspended'].includes(status)) throw new Error('Estado no válido.');
    commit(data => {
      const org = data.organizations.find(row => row.id === orgId);
      if (!org) throw new Error('Organización inexistente.');
      org.status = status;
      data.events.unshift({ id: id('event'), orgId, actorId: user.id, action: `organization_${status}`, createdAt: now() });
    });
  }
  function emailField(value) {
    const email = text(value, 254, 'Email', 3);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido.');
    return email;
  }
  function updateOrganization(orgId, fields) {
    requireRole('superadmin');
    commit(data => {
      const org = data.organizations.find(row => row.id === orgId);
      if (!org) throw new Error('Organización inexistente.');
      const name = text(fields.name, 120, 'Organización', 1);
      const domain = text(fields.domain || '', 253, 'Dominio');
      if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new Error('Dominio no válido.');
      if (data.organizations.some(row => row.id !== orgId && (row.name.toLowerCase() === name.toLowerCase() || (domain && row.domain?.toLowerCase() === domain.toLowerCase())))) throw new Error('La organización ya existe.');
      const admin = data.users.find(row => row.id === fields.adminId && row.orgId === orgId && ['admin', 'superadmin'].includes(row.role));
      if (!admin) throw new Error('Selecciona un administrador de esta organización.');
      if (!Number.isInteger(fields.members) || fields.members < data.users.filter(row => row.orgId === orgId).length) throw new Error('Miembros debe ser un entero igual o mayor que los usuarios registrados.');
      const email = emailField(fields.email);
      if (data.users.some(row => row.id !== admin.id && row.email?.toLowerCase() === email.toLowerCase())) throw new Error('El correo ya existe.');
      Object.assign(org, { name, domain, plan: fields.plan, status: fields.status, members: fields.members, adminId: admin.id, initials: name.slice(0, 2).toUpperCase() });
      admin.email = email;
    });
  }
  function deleteOrganization(orgId) {
    const actor = requireRole('superadmin');
    commit(data => {
      if (orgId === seed.config.defaultOrgId || orgId === actor.orgId) throw new Error('No puedes eliminar la organización predeterminada o la de tu sesión.');
      if (!data.organizations.some(row => row.id === orgId)) throw new Error('Organización inexistente.');
      const userIds = new Set(data.users.filter(row => row.orgId === orgId).map(row => row.id));
      if (Object.values(seed.config.demoRoles).some(userId => userIds.has(userId))) throw new Error('La organización contiene identidades de demostración protegidas.');
      const appIds = new Set(data.apps.filter(row => row.orgId === orgId).map(row => row.id));
      data.organizations = data.organizations.filter(row => row.id !== orgId);
      data.policies = data.policies.filter(row => row.orgId !== orgId);
      data.users = data.users.filter(row => !userIds.has(row.id));
      data.apps = data.apps.filter(row => !appIds.has(row.id));
      data.reviews = data.reviews.filter(row => !appIds.has(row.appId) && !userIds.has(row.reviewerId));
      data.events = data.events.filter(row => row.orgId !== orgId && !appIds.has(row.appId) && !userIds.has(row.actorId));
    });
  }
  function managedOrg(data, orgId, actor) {
    if (actor.role !== 'superadmin' && orgId !== actor.orgId) throw new Error('No puedes gestionar otra organización.');
    return activeOrg(data, orgId);
  }
  function saveCompanyProfile(orgId, fields) {
    const actor = requireRole('admin', 'superadmin');
    commit(data => {
      const org = managedOrg(data, orgId, actor);
      const name = text(fields.name, 120, 'Organización', 1);
      const domain = text(fields.domain || '', 253, 'Dominio');
      if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new Error('Dominio no válido.');
      if (data.organizations.some(row => row.id !== orgId && (row.name.toLowerCase() === name.toLowerCase() || (domain && row.domain?.toLowerCase() === domain.toLowerCase())))) throw new Error('La organización ya existe.');
      org.name = name; org.domain = domain;
      org.initials = name.split(/\s+/).map(word => word[0]).join('').slice(0, 2).toUpperCase();
      org.profile = { bio: text(fields.bio || '', 2000, 'Descripción'), bannerTitle: text(fields.bannerTitle || '', 160, 'Título del banner'), bannerDesc: text(fields.bannerDesc || '', 2000, 'Descripción del banner') };
    });
  }
  function deleteCompanyProfile(orgId) {
    const actor = requireRole('admin', 'superadmin');
    commit(data => { delete managedOrg(data, orgId, actor).profile; });
  }
  function saveManagedApp(appId, fields, expectedVersion) {
    const actor = requireRole('admin', 'superadmin');
    const values = submissionFields(fields), recordId = appId || id('app');
    const hours = fields.hours, users = fields.users;
    if (!Number.isSafeInteger(hours) || hours < 0 || !Number.isSafeInteger(users) || users < 0) throw new Error('Horas y usuarios deben ser enteros no negativos.');
    commit(data => {
      const existing = appId ? data.apps.find(row => row.id === appId) : null;
      if (appId && !existing) throw new Error('Aplicación inexistente.');
      const orgId = existing?.orgId || fields.orgId;
      managedOrg(data, orgId, actor);
      if (existing && expectedVersion !== existing.version) throw new Error('La aplicación cambió de versión. Recarga el formulario.');
      const author = data.users.find(row => row.id === fields.authorId && row.orgId === orgId && row.role === 'developer');
      if (!author) throw new Error('Selecciona un creador de esta organización.');
      const date = now();
      const app = existing || { id: recordId, orgId, ticket: `DEMO-${recordId}`, tags: [], createdAt: date, version: 0 };
      const longDesc = existing && existing.desc === values.desc ? (existing.longDesc || values.desc) : values.desc;
      const tech = fields.aiTool === undefined && existing ? existing.tech : [...values.tech, ...(existing?.tech?.slice(1) || [])];
      const attachments = fields.attachments === undefined && existing ? existing.attachments : values.attachments;
      Object.assign(app, values, { longDesc, tech, attachments, authorId: author.id, metrics: { hours, users, rating: existing?.metrics?.rating || '—' }, security: [], reviewStatus: 'pending_review', maturity: 'new', version: app.version + 1, updatedAt: date });
      delete app.certificate; delete app.environment;
      if (!existing) data.apps.push(app);
      data.events.unshift({ id: id('event'), orgId, appId: recordId, actorId: actor.id, action: existing ? 'resubmitted' : 'submitted', createdAt: date });
    });
    return recordId;
  }
  function deleteManagedApp(appId, expectedVersion) {
    const actor = requireRole('admin', 'superadmin');
    commit(data => {
      const app = data.apps.find(row => row.id === appId);
      if (!app) throw new Error('Aplicación inexistente.');
      managedOrg(data, app.orgId, actor);
      if (expectedVersion !== app.version) throw new Error('La aplicación cambió de versión.');
      data.apps = data.apps.filter(row => row.id !== appId);
      data.reviews = data.reviews.filter(row => row.appId !== appId);
      data.events = data.events.filter(row => row.appId !== appId);
    });
  }
  function saveUser(userId, fields) {
    const actor = requireRole('admin', 'superadmin');
    const recordId = userId || id('user');
    commit(data => {
      const existing = userId ? data.users.find(row => row.id === userId) : null;
      if (userId && !existing) throw new Error('Usuario inexistente.');
      if (actor.role !== 'superadmin') {
        managedOrg(data, fields.orgId, actor);
        if ((existing && (existing.orgId !== actor.orgId || !['developer', 'catalog'].includes(existing.role))) || !['developer', 'catalog'].includes(fields.role)) throw new Error('Solo puedes gestionar creadores y empleados de tu organización.');
      }
      const name = text(fields.name, 120, 'Nombre', 1), email = emailField(fields.email);
      if (data.users.some(row => row.id !== recordId && row.email?.toLowerCase() === email.toLowerCase())) throw new Error('El correo ya existe.');
      const org = data.organizations.find(row => row.id === fields.orgId);
      if (!org) throw new Error('Organización inexistente.');
      if (!['developer', 'catalog', 'admin', 'superadmin'].includes(fields.role)) throw new Error('Rol inválido.');
      if (existing && (existing.orgId !== fields.orgId || existing.role !== fields.role)) {
        if (existing.id === actor.id || Object.values(seed.config.demoRoles).includes(existing.id)) throw new Error('No puedes cambiar el rol u organización de una identidad de demo o de tu sesión.');
        if (data.organizations.some(row => row.adminId === userId) && (existing.orgId !== fields.orgId || !['admin', 'superadmin'].includes(fields.role))) throw new Error('Asigna otro administrador a la organización antes de cambiar este usuario.');
        if (existing.orgId !== fields.orgId && data.apps.some(row => row.authorId === userId)) throw new Error('El usuario tiene aplicaciones en su organización.');
      }
      const values = { name, email, orgId: org.id, role: fields.role, dept: text(fields.dept || '', 120, 'Departamento'), initials: name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() };
      if (existing) {
        if (existing.orgId !== org.id) data.organizations.find(row => row.id === existing.orgId).members--;
        if (existing.orgId !== org.id) org.members++;
        Object.assign(existing, values);
      } else { data.users.push({ id: recordId, ...values }); org.members++; }
    });
    return recordId;
  }
  function deleteUser(userId) {
    const actor = requireRole('admin', 'superadmin');
    commit(data => {
      const user = data.users.find(row => row.id === userId);
      if (!user) throw new Error('Usuario inexistente.');
      if (actor.role !== 'superadmin') {
        managedOrg(data, user.orgId, actor);
        if (!['developer', 'catalog'].includes(user.role)) throw new Error('Solo puedes gestionar creadores y empleados de tu organización.');
      }
      if (userId === actor.id || Object.values(seed.config.demoRoles).includes(userId)) throw new Error('No puedes eliminar tu sesión ni identidades de demostración.');
      if (data.organizations.some(row => row.adminId === userId)) throw new Error('Asigna otro administrador antes de eliminar este usuario.');
      if (data.apps.some(row => row.authorId === userId) || data.reviews.some(row => row.reviewerId === userId)) throw new Error('El usuario tiene aplicaciones o revisiones vinculadas.');
      data.users = data.users.filter(row => row.id !== userId);
      data.events = data.events.filter(row => row.actorId !== userId);
      data.organizations.find(row => row.id === user.orgId).members--;
    });
  }
  function savePlan(planId, fields) {
    requireRole('superadmin');
    const recordId = planId || id('plan');
    commit(data => {
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
  function deletePlan(planId) {
    requireRole('superadmin');
    commit(data => {
      if (!data.plans.some(row => row.id === planId)) throw new Error('Plan inexistente.');
      if (data.organizations.some(row => row.plan === planId)) throw new Error('El plan está asignado a organizaciones. Cambia sus planes antes de eliminarlo.');
      data.plans = data.plans.filter(row => row.id !== planId);
    });
  }
  function savePolicy(policyId, fields) {
    requireRole('superadmin');
    const recordId = policyId || id('policy');
    commit(data => {
      const values = { name: text(fields.name, 120, 'Política', 1), description: text(fields.description || '', 3000, 'Descripción'), enabled: fields.enabled === true };
      const policy = data.policies.find(row => row.id === policyId);
      if (policyId && (!policy || policy.orgId !== undefined)) throw new Error('Política global inexistente.');
      if (policy) Object.assign(policy, values); else data.policies.push({ id: recordId, ...values });
    });
    return recordId;
  }
  function deletePolicy(policyId) {
    requireRole('superadmin');
    commit(data => {
      if (!data.policies.some(row => row.id === policyId && row.orgId === undefined)) throw new Error('Política global inexistente.');
      data.policies = data.policies.filter(row => row.id !== policyId);
    });
  }
  function governancePolicies() {
    return copy(state.policies.filter(policy => policy.orgId === currentOrg().id || policy.orgId === undefined));
  }
  function saveGovernancePolicy(policyId, fields, expectedVersion) {
    const actor = requireRole('admin', 'superadmin');
    const recordId = policyId || id('policy');
    const values = { name: text(fields.name, 120, 'Política', 1), description: text(fields.description || '', 3000, 'Descripción'), enabled: fields.enabled === true };
    commit(data => {
      managedOrg(data, actor.orgId, actor);
      const policy = data.policies.find(row => row.id === policyId);
      if (policyId && (!policy || policy.orgId !== actor.orgId)) throw new Error('Solo puedes editar políticas de tu organización.');
      if (policy && policy.version !== expectedVersion) throw new Error('La política cambió en otra pestaña. Recarga el formulario.');
      if (policy) Object.assign(policy, values, { version: policy.version + 1, updatedAt: now() });
      else data.policies.push({ id: recordId, orgId: actor.orgId, ...values, version: 1, createdAt: now(), updatedAt: now() });
    });
    return recordId;
  }
  function deleteGovernancePolicy(policyId, expectedVersion) {
    const actor = requireRole('admin', 'superadmin');
    commit(data => {
      managedOrg(data, actor.orgId, actor);
      const policy = data.policies.find(row => row.id === policyId);
      if (!policy || policy.orgId !== actor.orgId) throw new Error('Solo puedes eliminar políticas de tu organización.');
      if (policy.version !== expectedVersion) throw new Error('La política cambió en otra pestaña.');
      data.policies = data.policies.filter(row => row.id !== policyId);
    });
  }
  const brandMap = { accent: '--accent', bg: '--bg', card: '--card', fg: '--fg', fgSoft: '--fg-soft', line: '--line', green: '--green', amber: '--amber', displayFont: '--display-font', bodyFont: '--body-font', rCard: '--r-card', rSm: '--r-sm' };
  function safeBrand(tokens) {
    const result = {};
    for (const key of Object.keys(brandMap)) {
      const value = tokens[key];
      if (typeof value !== 'string') throw new Error('Token de marca inválido.');
      const valid = key.endsWith('Font') ? /^[a-zA-Z0-9 ,"'\-]+$/.test(value) : key.startsWith('r') ? /^\d{1,3}px$/.test(value) : /^#[0-9a-f]{6}$/i.test(value);
      if (!valid) throw new Error(`Token de marca inválido: ${key}.`);
      result[key] = value;
    }
    return result;
  }
  function applyBrand() {
    if (!state) return;
    const tokens = { ...seed.config.brandDefaults, ...currentOrg().brand };
    Object.entries(safeBrand(tokens)).forEach(([key, value]) => document.documentElement.style.setProperty(brandMap[key], value));
  }
  function saveBrand(tokens) {
    const user = requireRole('admin', 'superadmin');
    const values = safeBrand(tokens);
    commit(data => { activeOrg(data, user.orgId).brand = values; });
  }
  function hydrateText() {
    const page = pageNames[location.pathname.split('/').pop()] || 'index';
    const values = seed.content[page]?.texts || {};
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
    const markers = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.startsWith('blk:text:')) markers.push(walker.currentNode);
    for (const marker of markers) {
      const key = marker.nodeValue.slice(9);
      if (!(key in values)) throw new Error(`Contenido ausente: ${page}.${key}`);
      marker.replaceWith(document.createTextNode(values[key]));
    }
    for (const attribute of ['text', 'value', 'placeholder', 'title', 'alt']) {
      document.querySelectorAll(`[data-blk-${attribute}]`).forEach(el => {
        const key = el.getAttribute(`data-blk-${attribute}`);
        if (!(key in values)) throw new Error(`Valor ausente: ${page}.${key}`);
        if (attribute === 'value') el.value = values[key];
        else if (attribute === 'text') el.textContent = values[key];
        else el.setAttribute(attribute, values[key]);
      });
    }
  }
  function showError(error) {
    console.error(error);
    let box = document.getElementById('blk-data-error');
    if (!box) {
      box = document.createElement('div'); box.id = 'blk-data-error'; box.setAttribute('role', 'alert');
      box.style.cssText = 'position:fixed;inset:12px 12px auto;z-index:10000;padding:20px;background:#fff;border:2px solid #b91c1c;color:#111;border-radius:12px;font:14px system-ui';
      document.body.appendChild(box);
    }
    box.replaceChildren();
    const message = document.createElement('p');
    message.textContent = `No se pudo cargar o guardar la demo: ${error.message || error}. Usa un servidor HTTP local y comprueba data.json. No se ha confirmado ningún cambio fallido.`;
    box.appendChild(message);
    const retry = document.createElement('button'); retry.textContent = 'Reintentar'; retry.onclick = () => location.reload(); box.appendChild(retry);
    const reset = document.createElement('button'); reset.textContent = 'Reiniciar datos de demo'; reset.onclick = () => { try { localStorage.removeItem(KEY); sessionStorage.removeItem(SESSION_KEY); location.reload(); } catch (failure) { message.textContent = failure.message; } }; box.appendChild(reset);
  }
  function reset() {
    localStorage.removeItem(KEY); sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('blk_viarapida_css_tokens');
    state = copy(seed); session = null;
    emit();
  }
  function addDemoControls() {
    const bar = document.createElement('div'); bar.id = 'blk-demo-controls';
    bar.style.cssText = 'position:fixed;bottom:6px;left:6px;z-index:150;padding:5px 9px;border:1px solid #777;border-radius:8px;background:#fff;color:#111;font:11px system-ui;display:flex;gap:8px;align-items:center';
    const label = document.createElement('span'); label.textContent = 'DEMO LOCAL · Sin SSO/DLP real'; bar.appendChild(label);
    const login = document.createElement('a'); login.href = 'login.html'; login.textContent = 'Cambiar rol'; bar.appendChild(login);
    const button = document.createElement('button'); button.textContent = 'Reiniciar'; button.onclick = () => { if (window.confirm('¿Restaurar los datos de demostración? Se perderán los cambios locales de BLK.')) { try { reset(); location.reload(); } catch (error) { showError(error); } } }; bar.appendChild(button);
    document.body.appendChild(bar);
  }
  const domReady = document.readyState === 'loading' ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true })) : Promise.resolve();
  const api = {
    get data() { return copy(state); }, get config() { return copy(seed.config); }, get categories() { return copy(seed.categories); },
    content: page => copy(seed.content[page] || {}), currentOrg, currentUser, apps, catalogApps, catalogApp,
    reviews: appId => copy(state.reviews.filter(review => !appId || review.appId === appId)),
    subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    setRole, createSubmission, updateSubmission, reviewApp, organizations, createOrganization, updateOrganization, deleteOrganization, setOrganizationStatus,
    saveUser, deleteUser, saveCompanyProfile, deleteCompanyProfile, saveManagedApp, deleteManagedApp, savePlan, deletePlan, savePolicy, deletePolicy, governancePolicies, saveGovernancePolicy, deleteGovernancePolicy, saveBrand,
    reset, validate, showError,
    escape: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    exportData: () => copy(state)
  };
  window.BLK = api;
  api.ready = Promise.all([fetch(new URL('../../data.json', document.currentScript.src)).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status} al cargar data.json`); return response.json(); }), domReady]).then(([data]) => {
    seed = validate(data);
    state = latest();
    try { const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY)); if (stored && state.users.some(user => user.id === stored.userId && user.orgId === stored.orgId && user.role === stored.role)) session = stored; } catch { session = null; }
    hydrateText(); applyBrand(); addDemoControls();
    return api;
  });
  // A rejected loader must remain rejected for consumers, but also show a recovery action.
  api.ready.catch(async error => { await domReady; showError(error); });
  window.addEventListener('storage', event => {
    if (event.key !== KEY || !seed) return;
    try { state = latest(); emit(); } catch (error) { showError(error); }
  });
})();
