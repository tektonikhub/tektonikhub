  window.BLK.ready.then(() => {
    const I18N = window.BLK.content("companyProfile").I18N;

    let currentLang = 'es';

    function setLanguage(lang) {
      if (!I18N[lang]) return;
      currentLang = lang;
      document.documentElement.lang = lang;
      try { localStorage.setItem('blkunit:lang', lang); } catch (e) { }

      document.querySelectorAll('[data-set-lang]').forEach(btn => {
        if (btn.getAttribute('data-set-lang') === lang) {
          btn.setAttribute('aria-current', 'page');
        } else {
          btn.removeAttribute('aria-current');
        }
      });

      const d = I18N[lang];
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (d[key] !== undefined) {
          el.innerHTML = d[key];
        }
      });

      if (document.getElementById('meta-title')) document.getElementById('meta-title').innerText = d.metaTitle;
      if (document.getElementById('meta-desc')) document.getElementById('meta-desc').setAttribute('content', d.metaDesc);
      if (document.getElementById('og-title')) document.getElementById('og-title').setAttribute('content', d.metaTitle);
      if (document.getElementById('og-desc')) document.getElementById('og-desc').setAttribute('content', d.metaDesc);
      renderCompany();
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      t.innerText = msg;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
    }

    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-set-lang]');
      if (btn) {
        const lang = btn.getAttribute('data-set-lang');
        setLanguage(lang);
      }
    });

    const PAGE = "companyProfile";

    function contentValue(path) {
      return path.split('.').reduce((value, key) => value == null ? undefined : value[key], window.BLK.content(PAGE));
    }
    function bindContent() {
      document.querySelectorAll('[data-content]').forEach(el => {
        if (el.closest('#tool-modal.open')) return;
        const value = contentValue(el.dataset.content);
        if (value !== undefined) el.textContent = value;
      });
    }
    function setText(selector, value, root = document) {
      const el = root.querySelector(selector);
      if (el) el.textContent = value == null ? '' : value;
    }
    function formatNumber(value) {
      return Number(value || 0).toLocaleString(currentLang === 'en' ? 'en-US' : 'es-ES');
    }
    function approvedFor(user) {
      const org = window.BLK.currentOrg();
      const ids = new Set(window.BLK.apps({orgId: org.id, authorId: user.id, includeUnpublished: true}).map(app => app.id));
      return window.BLK.catalogApps().filter(app => ids.has(app.id));
    }
    function bindIdentity(user = window.BLK.currentUser()) {
      const org = window.BLK.currentOrg();
      document.querySelectorAll('[data-org-field]').forEach(el => {
        el.textContent = el.dataset.orgField === 'initials' ? (org.initials || org.name.split(/\s+/).map(word => word[0]).join('').slice(0, 2)) : (org[el.dataset.orgField] == null ? '' : org[el.dataset.orgField]);
      });
      document.querySelectorAll('[data-user-field]').forEach(el => {
        el.textContent = user[el.dataset.userField] == null ? '' : user[el.dataset.userField];
      });
    }
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-copy-content]');
      if (button) copyCommand(contentValue(button.dataset.copyContent));
    });

    const BLK = window.BLK;
    const words = {
      es: { editProfile: 'Editar empresa', resetProfile: 'Restablecer textos', newUser: 'Añadir usuario', newApp: 'Añadir aplicación', edit: 'Editar', remove: 'Eliminar', approve: 'Aprobar', name: 'Nombre', domain: 'Dominio', bio: 'Descripción de la empresa', bannerTitle: 'Título del banner', bannerDesc: 'Descripción del banner', email: 'Correo', dept: 'Departamento', role: 'Rol', title: 'Título', desc: 'Descripción (mínimo 30 caracteres)', area: 'Área', authorId: 'Creador', aiTool: 'Tecnología principal', repoUrl: 'URL HTTP/HTTPS', hours: 'Horas ahorradas', users: 'Usuarios', save: 'Guardar', cancel: 'Cancelar', saved: 'Cambios guardados', deleted: 'Registro eliminado', confirm: '¿Eliminar este registro? Esta acción no se puede deshacer.', resetConfirm: '¿Restablecer los textos de la empresa? Se conservan nombre, dominio, usuarios y aplicaciones.', emptyUsers: 'Sin usuarios', search: 'Buscar', all: 'Todos los estados', note: 'Las aplicaciones nuevas o editadas vuelven a revisión. Solo las aprobadas son visibles para visitantes.', manageUsers: 'Usuarios de la empresa', manageApps: 'Aplicaciones de la empresa' },
      en: { editProfile: 'Edit company', resetProfile: 'Reset texts', newUser: 'Add user', newApp: 'Add application', edit: 'Edit', remove: 'Delete', approve: 'Approve', name: 'Name', domain: 'Domain', bio: 'Company description', bannerTitle: 'Banner title', bannerDesc: 'Banner description', email: 'Email', dept: 'Department', role: 'Role', title: 'Title', desc: 'Description (at least 30 characters)', area: 'Area', authorId: 'Creator', aiTool: 'Main technology', repoUrl: 'HTTP/HTTPS URL', hours: 'Hours saved', users: 'Users', save: 'Save', cancel: 'Cancel', saved: 'Changes saved', deleted: 'Record deleted', confirm: 'Delete this record? This cannot be undone.', resetConfirm: 'Reset company texts? Name, domain, users and applications will be kept.', emptyUsers: 'No users', search: 'Search', all: 'All statuses', note: 'New or edited applications return to review. Only approved applications are visible to visitors.', manageUsers: 'Company users', manageApps: 'Company applications' }
    };
    const w = key => words[currentLang][key];
    const canManage = () => ['admin', 'superadmin'].includes(BLK.currentUser().role) && !['pending', 'suspended'].includes(BLK.currentOrg().status);
    const canManageUser = user => BLK.currentUser().role === 'superadmin' || ['developer', 'catalog'].includes(user.role);
    const statuses = ['approved', 'pending_review', 'changes_requested', 'rejected'];
    let editing = null, query = '', statusFilter = '';
    let toastTimer;
    const dialog = document.getElementById('company-dialog');
    const form = document.getElementById('company-form');
    const profileActions = document.createElement('div'); profileActions.className = 'company-actions'; profileActions.id = 'company-profile-actions';
    document.querySelector('.org-header-row').after(profileActions);
    const toolbar = document.createElement('div'); toolbar.className = 'company-toolbar'; toolbar.id = 'company-toolbar';
    document.querySelector('.creators-grid').before(toolbar);
    function actionButton(action, label, recordId = '', version) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.companyAction = action;
      button.textContent = label; if (recordId) button.dataset.recordId = recordId;
      if (version !== undefined) button.dataset.version = version;
      if (action.startsWith('delete')) button.className = 'company-danger';
      return button;
    }
    function actionsFor(card, type, record) {
      const actions = document.createElement('div'); actions.className = 'company-actions';
      actions.append(actionButton('edit-' + type, w('edit'), record.id), actionButton('delete-' + type, w('remove'), record.id, record.version));
      if (type === 'app' && record.reviewStatus === 'pending_review') actions.append(actionButton('approve-app', w('approve'), record.id, record.version));
      card.append(actions);
    }
    function renderControls() {
      const manage = canManage(); profileActions.hidden = !manage; toolbar.hidden = !manage;
      profileActions.replaceChildren(actionButton('edit-profile', w('editProfile')), actionButton('delete-profile', w('resetProfile')));
      toolbar.replaceChildren(actionButton('new-user', w('newUser')), actionButton('new-app', w('newApp')));
      const search = document.createElement('input'); search.type = 'search'; search.placeholder = w('search'); search.setAttribute('aria-label', w('search')); search.value = query;
      search.id = 'company-search'; search.addEventListener('input', () => { query = search.value; renderLists(); });
      const filter = document.createElement('select'); filter.id = 'company-status'; filter.setAttribute('aria-label', w('all'));
      filter.add(new Option(w('all'), '')); statuses.forEach(value => filter.add(new Option(BLK.config.statusLabels[value], value))); filter.value = statusFilter;
      filter.addEventListener('change', () => { statusFilter = filter.value; renderLists(); }); toolbar.append(search, filter);
      if (!manage && dialog.open) { dialog.close(); editing = null; }
    }
    function field(key, value = '', options) {
      const label = document.createElement('label'); label.textContent = w(key);
      const input = document.createElement(options ? 'select' : ['bio', 'bannerDesc', 'desc'].includes(key) ? 'textarea' : 'input');
      input.name = key; input.id = 'company-' + key;
      if (options) options.forEach(([id, name]) => input.add(new Option(name, id)));
      else {
        input.type = key === 'email' ? 'email' : ['hours', 'users'].includes(key) ? 'number' : key === 'repoUrl' ? 'url' : 'text';
        input.maxLength = ({ name: 120, domain: 253, bio: 2000, bannerTitle: 160, bannerDesc: 2000, email: 254, dept: 120, title: 60, desc: 800, aiTool: 100, repoUrl: 1000 })[key] || 2000;
        if (['hours', 'users'].includes(key)) { input.min = '0'; input.step = '1'; }
        if (key === 'desc') input.minLength = 30;
      }
      input.required = ['name', 'email', 'title', 'desc', 'area', 'authorId', 'role', 'hours', 'users'].includes(key);
      input.value = value; label.append(input); document.getElementById('company-fields').append(label);
    }
    function openEditor(type, recordId) {
      const org = BLK.currentOrg(), data = BLK.data;
      const record = type === 'profile' ? org : data[type === 'user' ? 'users' : 'apps'].find(row => row.id === recordId);
      if (recordId && (!record || record.orgId !== org.id)) throw new Error('Registro inexistente.');
      editing = { type, id: recordId || null, orgId: org.id, version: record?.version };
      document.getElementById('company-dialog-title').textContent = w(type === 'profile' ? 'editProfile' : record ? 'edit' : type === 'user' ? 'newUser' : 'newApp');
      document.getElementById('company-fields').replaceChildren(); document.getElementById('company-form-error').textContent = '';
      document.getElementById('company-cancel').textContent = w('cancel'); document.getElementById('company-save').textContent = w('save');
      if (type === 'profile') {
        field('name', org.name); field('domain', org.domain);
        ['bio', 'bannerTitle', 'bannerDesc'].forEach(key => field(key, org.profile?.[key] ?? I18N[currentLang][({ bio: 'orgBio', bannerTitle: 'itBannerTitle', bannerDesc: 'itBannerDesc' })[key]].replaceAll('Via Rapida', org.name)));
      } else if (type === 'user') {
        ['name', 'email', 'dept'].forEach(key => field(key, record?.[key] || ''));
        field('role', record?.role || 'developer', (BLK.currentUser().role === 'superadmin' ? ['developer', 'catalog', 'admin', 'superadmin'] : ['developer', 'catalog']).map(role => [role, role]));
      } else {
        ['title', 'desc'].forEach(key => field(key, record?.[key] || ''));
        field('area', record?.area || BLK.categories[0].id, BLK.categories.map(row => [row.id, row.label]));
        field('authorId', record?.authorId || '', data.users.filter(row => row.orgId === org.id && row.role === 'developer').map(row => [row.id, row.name]));
        field('aiTool', record?.tech?.[0] || ''); field('repoUrl', record?.repoUrl || ''); field('hours', record?.metrics?.hours || 0); field('users', record?.metrics?.users || 0);
        const note = document.createElement('p'); note.className = 'company-note'; note.textContent = w('note'); document.getElementById('company-fields').append(note);
      }
      dialog.showModal();
    }
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        if (!editing || !canManage() || editing.orgId !== BLK.currentOrg().id) throw new Error('Sesión de edición no válida.');
        const fields = Object.fromEntries(new FormData(form));
        if (editing.type === 'profile') BLK.saveCompanyProfile(editing.orgId, fields);
        else if (editing.type === 'user') BLK.saveUser(editing.id, { ...fields, orgId: editing.orgId });
        else {
          const existing = BLK.data.apps.find(row => row.id === editing.id);
          BLK.saveManagedApp(editing.id, { ...existing, ...fields, orgId: editing.orgId, hours: Number(fields.hours), users: Number(fields.users) }, editing.version);
        }
        dialog.close(); editing = null; showToast(w('saved'));
      } catch (error) { document.getElementById('company-form-error').textContent = error.message; }
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-company-action]'); if (!button) return;
      const action = button.dataset.companyAction, recordId = button.dataset.recordId, version = Number(button.dataset.version);
      if (action === 'close') { dialog.close(); editing = null; return; }
      try {
        if (!canManage()) throw new Error('Selecciona el rol administrador.');
        if (action.startsWith('edit-') || action.startsWith('new-')) openEditor(action.split('-')[1], recordId);
        else if (action === 'approve-app') { BLK.reviewApp(recordId, 'approved', '', 'Catálogo DEMO', version); showToast(w('saved')); }
        else if (window.confirm(w(action === 'delete-profile' ? 'resetConfirm' : 'confirm'))) {
          if (action === 'delete-profile') BLK.deleteCompanyProfile(BLK.currentOrg().id);
          else if (action === 'delete-user') BLK.deleteUser(recordId);
          else if (action === 'delete-app') BLK.deleteManagedApp(recordId, version);
          showToast(w('deleted'));
        }
      } catch (error) { showToast(error.message); }
    });
    function renderCompany() {
      bindContent(); bindIdentity(); renderControls();
      const org = window.BLK.currentOrg();
      const d = I18N[currentLang];
      setText('[data-i18n="orgBio"]', org.profile?.bio ?? d.orgBio.replaceAll('Via Rapida', org.name));
      setText('[data-i18n="itBannerTitle"]', org.profile?.bannerTitle ?? d.itBannerTitle);
      setText('[data-i18n="itBannerDesc"]', org.profile?.bannerDesc ?? d.itBannerDesc.replaceAll('Via Rapida', org.name));
      const title = `${org.name} · Tektonik hub`;
      document.title = title; document.getElementById('og-title').content = title;
      const description = org.profile?.bio ?? d.orgBio.replaceAll('Via Rapida', org.name);
      document.getElementById('meta-desc').content = description; document.getElementById('og-desc').content = description;
      setText('.org-cover .cover-tag', org.name.toUpperCase());
      setText('.org-subtitle', org.domain || org.id);
      setText('footer .wrap > div span', org.name);
      setText('footer .wrap > span', new URL('company-profile.html', location.href).href);
      const raw = window.BLK.apps({orgId: org.id, includeUnpublished: true});
      const ids = new Set(raw.map(app => app.id));
      const apps = window.BLK.catalogApps().filter(app => ids.has(app.id));
      const stats = document.querySelectorAll('.org-stats-bar .stat-num');
      [formatNumber(apps.length), formatNumber(org.members)].forEach((value, i) => stats[i].textContent = value);
      renderLists();
    }
    function renderLists() {
      const org = BLK.currentOrg(), manage = canManage();
      const raw = BLK.apps({ orgId: org.id, includeUnpublished: true });
      const apps = (manage ? raw.map(BLK.catalogApp) : BLK.catalogApps()).filter(app => !manage || ((!statusFilter || app.reviewStatus === statusFilter) && `${app.title} ${app.desc} ${app.author.name}`.toLowerCase().includes(query.toLowerCase())));
      setText('[data-i18n="catTitle"]', manage ? w('manageApps') : I18N[currentLang].catTitle);
      setText('[data-i18n="catSubtitle"]', manage ? w('note') : I18N[currentLang].catSubtitle);
      setText('[data-i18n="topDevsTitle"]', manage ? w('manageUsers') : I18N[currentLang].topDevsTitle);
      const grid = document.querySelector('.apps-grid'); grid.replaceChildren();
      const appTemplate = document.getElementById('company-app-template');
      apps.forEach(app => {
        const card = appTemplate.content.firstElementChild.cloneNode(true);
        setText('.app-meta-row span:first-child', app.areaLabel, card);
        setText('.app-meta-row span:last-child', app.security.join(' • '), card);
        setText('.app-title', app.title, card); setText('.app-desc', app.desc, card);
        const link = card.querySelector('a');
        link.textContent = I18N[currentLang].appLaunch;
        link.href = 'app-catalog.html?app=' + encodeURIComponent(app.id);
        link.hidden = app.reviewStatus !== 'approved';
        if (manage) {
          setText('.app-meta-row span:last-child', BLK.config.statusLabels[app.reviewStatus], card);
          card.querySelector('.app-meta-row span:last-child').style.color = app.reviewStatus === 'approved' ? 'var(--green)' : 'var(--muted)';
          actionsFor(card.querySelector('.app-body'), 'app', app);
        }
        grid.append(card);
      });
      if (!apps.length) { const empty = document.createElement('p'); empty.textContent = I18N[currentLang].emptyApps; grid.append(empty); }
      const creators = document.querySelector('.creators-grid'); creators.replaceChildren();
      const creatorTemplate = document.getElementById('company-creator-template');
      const publishedAuthors = new Set(apps.map(app => app.authorId));
      const users = BLK.data.users.filter(user => user.orgId === org.id && (manage ? `${user.name} ${user.email} ${user.dept}`.toLowerCase().includes(query.toLowerCase()) : publishedAuthors.has(user.id)));
      users.forEach(user => {
        const card = creatorTemplate.content.firstElementChild.cloneNode(true);
        setText('.c-avatar-mini', user.initials, card);
        setText('[data-creator-name]', user.name, card);
        setText('[data-creator-dept]', user.dept, card);
        const owned = raw.filter(item => item.authorId === user.id && item.reviewStatus === 'approved');
        setText('p', manage ? `${user.email || ''} · ${user.role}` : owned.map(item => item.title).join(' • '), card);
        const link = card.querySelector('a'); link.textContent = I18N[currentLang].cViewSpace;
        link.href = 'profile.html?user=' + encodeURIComponent(user.id);
        if (manage && canManageUser(user)) actionsFor(card, 'user', user);
        creators.append(card);
      });
      if (!users.length) { const empty = document.createElement('p'); empty.textContent = w('emptyUsers'); creators.append(empty); }
    }

    function shareOrganization() {
      const url = new URL('company-profile.html', location.href).href;
      navigator.clipboard.writeText(url).then(() => showToast(I18N[currentLang].toastShare)).catch(() => showToast(url));
    }

    (function init() {
      let lang = 'es';
      try {
        const stored = localStorage.getItem('blkunit:lang');
        if (stored === 'en' || stored === 'es') lang = stored;
      } catch (e) { }
      setLanguage(lang);
    })();
  
    Object.assign(window, { setLanguage, showToast, shareOrganization });
    Object.defineProperty(window, "I18N", { configurable: true, get: () => I18N });
    Object.defineProperty(window, "currentLang", { configurable: true, get: () => currentLang });
    window.BLK.subscribe(() => { renderCompany(); });

  }).catch(window.BLK.showError);

