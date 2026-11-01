(() => {
  'use strict';
  BLK.ready.then(() => {
    const $ = id => document.getElementById(id);
    const esc = BLK.escape;
    const titles = { 'all-orgs': 'Todas las organizaciones', 'pending-orgs': 'Organizaciones pendientes', 'suspended-orgs': 'Organizaciones suspendidas', 'all-users': 'Todos los usuarios', admins: 'Administradores', superadmins: 'Super administradores', plans: 'Planes', policies: 'Políticas globales' };
    const roles = { developer: 'Developer', catalog: 'Empleado', admin: 'Administrador', superadmin: 'Super administrador' };
    const statuses = { active: 'ACTIVA', 'active-amber': 'ACTIVA CON AVISO', suspended: 'SUSPENDIDA', pending: 'PENDIENTE' };
    let selectedOrgId = null, editingOrgId = null, editor = null;
    let currentFilter = 'all', currentSearch = '';
    const searches = {};
    const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
    const action = (fn, id, label, danger = false) => `<button class="action-btn${danger ? ' danger' : ''}" onclick="${fn}('${esc(id)}')">${esc(label)}</button>`;
    const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(value => `<th>${esc(value)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" style="padding:24px;text-align:center">Sin registros</td></tr>`}</tbody></table></div>`;
    function showToast(message, type = 'success') {
      const toast = document.createElement('div');
      toast.className = 'toast ' + type; toast.textContent = message; toast.setAttribute('role', 'status');
      $('toastContainer').appendChild(toast); setTimeout(() => toast.remove(), 4000);
    }
    function perform(fn, message) {
      try { fn(); if (message) showToast(message); return true; }
      catch (error) { showToast(error.message, 'error'); return false; }
    }
    function orgRows(orgs) {
      const plans = BLK.data.plans;
      return orgs.map(org => [
        `<div class="org-cell"><div class="org-avatar">${esc(org.initials)}</div><div><div class="org-name">${esc(org.name)}</div><div class="org-id">${esc(org.id)}</div></div></div>`,
        esc(plans.find(plan => plan.id === org.plan)?.name || org.plan), esc(org.members), esc(org.apps), esc(org.pending), esc(org.compliance == null ? '—' : org.compliance + '%'),
        `<span class="status-badge ${esc(org.status)}">${esc(statuses[org.status])}</span>`,
        `<div class="action-btns">${action('openOrgDetail', org.id, 'Detalles')}${action('editOrg', org.id, 'Editar')}${org.status === 'pending' ? action('openReactivate', org.id, 'Aprobar') : org.status === 'suspended' ? action('openReactivate', org.id, 'Reactivar') : ''}${action('deleteOrg', org.id, 'Eliminar', true)}</div>`
      ]);
    }
    function renderTable() {
      const orgs = BLK.organizations().filter(org => (currentFilter === 'all' || (currentFilter === 'active' ? ['active', 'active-amber'].includes(org.status) : org.status === currentFilter)) && `${org.name} ${org.id} ${org.domain}`.toLowerCase().includes(currentSearch.toLowerCase()));
      $('orgsBody').innerHTML = orgRows(orgs).map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="8" style="padding:24px;text-align:center">No se encontraron organizaciones</td></tr>';
    }
    function filterTable() { currentSearch = $('orgSearch').value; renderTable(); }
    function setFilter(btn, value) {
      currentFilter = value; document.querySelectorAll('.filter-tab').forEach(el => el.classList.toggle('active', el === btn)); renderTable();
    }
    function renderPanel(key) {
      const data = BLK.data, orgs = BLK.organizations();
      const query = (searches[key] || '').toLowerCase();
      const matches = values => values.join(' ').toLowerCase().includes(query);
      let headers, rows;
      if (key.endsWith('orgs')) {
        const filtered = orgs.filter(org => (key === 'all-orgs' || org.status === (key === 'pending-orgs' ? 'pending' : 'suspended')) && matches([org.name, org.id, org.domain]));
        headers = ['Organización', 'Plan', 'Miembros', 'Apps', 'Pendientes', 'Compliance demo', 'Estado', 'Acciones']; rows = orgRows(filtered);
      } else if (['all-users', 'admins', 'superadmins'].includes(key)) {
        headers = ['Nombre', 'Email', 'Departamento', 'Rol', 'Organización', 'Acciones'];
        rows = data.users.filter(user => (key === 'all-users' || user.role === (key === 'admins' ? 'admin' : 'superadmin')) && matches([user.name, user.email, roles[user.role], orgs.find(org => org.id === user.orgId)?.name || ''])).map(user => [esc(user.name), esc(user.email), esc(user.dept), esc(roles[user.role]), esc(orgs.find(org => org.id === user.orgId)?.name), `<div class="action-btns">${action('editUser', user.id, 'Editar')}${action('removeUser', user.id, 'Eliminar', true)}</div>`]);
      } else if (key === 'plans') {
        headers = ['Plan', 'Precio mensual demo', 'Organizaciones', 'Acciones'];
        rows = data.plans.filter(plan => matches([plan.name])).map(plan => [esc(plan.name), esc(plan.price == null ? 'Consultar' : `${plan.price} €/mes`), esc(orgs.filter(org => org.plan === plan.id).length), `<div class="action-btns">${action('editPlan', plan.id, 'Editar')}${action('removePlan', plan.id, 'Eliminar', true)}</div>`]);
      } else {
        headers = ['Política', 'Descripción', 'Estado', 'Acciones'];
        rows = data.policies.filter(policy => policy.orgId === undefined && matches([policy.name, policy.description])).map(policy => [esc(policy.name), esc(policy.description), policy.enabled ? 'Habilitada' : 'Deshabilitada', `<div class="action-btns">${action('editPolicy', policy.id, 'Editar')}${action('removePolicy', policy.id, 'Eliminar', true)}</div>`]);
      }
      const panel = $('panel-' + key);
      let body = panel.querySelector('[data-live-panel]');
      if (!body) {
        const newAction = key.endsWith('orgs') ? 'openModal(\'newOrgModal\')' : key === 'plans' ? 'editPlan()' : key === 'policies' ? 'editPolicy()' : `editUser('', '${key === 'admins' ? 'admin' : key === 'superadmins' ? 'superadmin' : 'catalog'}')`;
        panel.innerHTML = `<div class="page-header"><div class="page-title"><h1>${esc(titles[key])}</h1><p>${key === 'policies' ? 'Configuración local informativa; no ejecuta controles ni escaneos.' : 'Datos compartidos y persistentes en este navegador.'}</p></div><button class="btn accent" onclick="${newAction}">Crear ${key.endsWith('orgs') ? 'organización' : key === 'plans' ? 'plan' : key === 'policies' ? 'política' : 'usuario'}</button></div><div class="card"><div class="card-header"><label class="search-box">Buscar <input aria-label="Buscar en ${esc(titles[key])}" oninput="searchPanel('${key}', this.value)"></label></div><div data-live-panel></div></div>`;
        body = panel.querySelector('[data-live-panel]');
      }
      body.innerHTML = table(headers, rows);
    }
    function searchPanel(key, value) { searches[key] = value; renderPanel(key); }
    function showPanel(key) {
      document.querySelectorAll('.panel').forEach(el => el.classList.toggle('active', el.id === 'panel-' + key));
      document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.panel === key));
      if (key !== 'dashboard' && key in titles) renderPanel(key);
    }
    function fillPlans(selected = '') { $('newOrgPlan').innerHTML = option('', 'Selecciona un plan', selected) + BLK.data.plans.map(plan => option(plan.id, plan.name, selected)).join(''); }
    function openModal(id) {
      if (id === 'newOrgModal' && !editingOrgId) {
        ['newOrgName', 'newOrgEmail', 'newOrgDomain'].forEach(key => $(key).value = ''); fillPlans();
        $('orgEditFields').hidden = true; $('orgFormTitle').textContent = 'Nueva organización'; $('saveOrgBtn').textContent = 'Crear organización';
      }
      $(id).classList.add('open');
      $(id).querySelector('input, button')?.focus();
    }
    function closeModal(id) { $(id).classList.remove('open'); if (id === 'newOrgModal') editingOrgId = null; }
    function openOrgDetail(org) {
      if (typeof org !== 'object') org = BLK.organizations().find(row => row.id === org);
      if (!org) return;
      selectedOrgId = org.id;
      const values = { detailAvatar: org.initials, detailName: org.name, detailId: org.id, detailMembers: org.members, detailApps: org.apps, detailCompliance: org.compliance == null ? '—' : org.compliance + '%', detailAdminAvatar: org.admin.initials, detailAdminName: org.admin.name, detailAdminEmail: org.admin.email, detailDate: org.date, detailDomain: org.domain || '—', detailPending: org.pending, detailLastAccess: org.lastAccess };
      Object.entries(values).forEach(([key, value]) => $(key).textContent = value);
      $('detailPlanBadge').textContent = BLK.data.plans.find(plan => plan.id === org.plan)?.name || org.plan;
      $('detailPlanBadge').className = 'plan-badge'; $('detailStatusBadge').textContent = statuses[org.status]; $('detailStatusBadge').className = 'status-badge ' + org.status;
      $('suspendBtn').textContent = org.status === 'suspended' ? 'Reactivar' : org.status === 'pending' ? 'Aprobar' : 'Suspender';
      openModal('orgDetailModal');
    }
    function editOrg(orgId = selectedOrgId) {
      const org = BLK.organizations().find(row => row.id === orgId); if (!org) return;
      closeModal('orgDetailModal'); editingOrgId = org.id;
      $('newOrgName').value = org.name; $('newOrgDomain').value = org.domain || ''; $('newOrgEmail').value = org.admin.email; fillPlans(org.plan);
      $('orgAdmin').innerHTML = BLK.data.users.filter(user => user.orgId === org.id && ['admin', 'superadmin'].includes(user.role)).map(user => option(user.id, user.name, org.adminId)).join('');
      $('orgMembers').value = org.members; $('orgStatus').value = org.status; $('orgEditFields').hidden = false;
      $('orgFormTitle').textContent = 'Editar organización'; $('saveOrgBtn').textContent = 'Guardar cambios'; openModal('newOrgModal');
    }
    function selectOrgAdmin() { $('newOrgEmail').value = BLK.data.users.find(user => user.id === $('orgAdmin').value)?.email || ''; }
    function createOrg() {
      const fields = { name: $('newOrgName').value, plan: $('newOrgPlan').value, email: $('newOrgEmail').value, domain: $('newOrgDomain').value };
      if (perform(() => editingOrgId ? BLK.updateOrganization(editingOrgId, { ...fields, adminId: $('orgAdmin').value, members: Number($('orgMembers').value), status: $('orgStatus').value }) : BLK.createOrganization(fields), 'Organización guardada.')) closeModal('newOrgModal');
    }
    function deleteOrg(orgId = selectedOrgId) {
      const org = BLK.organizations().find(row => row.id === orgId); if (!org) return;
      if (!confirm(`¿Eliminar "${org.name}" y todos sus usuarios, apps y revisiones? Esta acción no se puede deshacer.`)) return;
      if (perform(() => BLK.deleteOrganization(orgId), 'Organización eliminada.')) closeModal('orgDetailModal');
    }
    function suspendOrg() {
      const org = BLK.organizations().find(row => row.id === selectedOrgId); if (!org) return;
      if (perform(() => BLK.setOrganizationStatus(org.id, ['pending', 'suspended'].includes(org.status) ? 'active' : 'suspended'), 'Estado guardado.')) closeModal('orgDetailModal');
    }
    function openReactivate(orgId) { perform(() => BLK.setOrganizationStatus(orgId, 'active'), 'Organización activada.'); }
    function accessOrg() {
      const org = BLK.organizations().find(row => row.id === selectedOrgId);
      return perform(() => BLK.setRole(org?.admin.role || 'admin', selectedOrgId));
    }
    function input(name, label, value = '', type = 'text', required = false, max = 120) {
      return `<div class="form-group"><label class="form-label" for="record-${name}">${esc(label)}</label><input class="form-input" id="record-${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" step="0.01"' : `maxlength="${max}"`}></div>`;
    }
    function select(name, label, options) { return `<div class="form-group"><label class="form-label" for="record-${name}">${esc(label)}</label><select class="form-input" id="record-${name}" name="${name}" required>${options}</select></div>`; }
    function recordModal(type, id, html, label) { editor = { type, id: id || null }; $('recordTitle').textContent = (id ? 'Editar ' : 'Crear ') + label; $('recordFields').innerHTML = html; openModal('recordModal'); }
    function editUser(userId, defaultRole = 'catalog') {
      const user = BLK.data.users.find(row => row.id === userId) || { role: defaultRole, orgId: BLK.currentOrg().id };
      recordModal('user', userId, input('name', 'Nombre', user.name, 'text', true) + input('email', 'Email', user.email, 'email', true, 254) + input('dept', 'Departamento', user.dept) + select('role', 'Rol', Object.entries(roles).map(([key, value]) => option(key, value, user.role)).join('')) + select('orgId', 'Organización', BLK.organizations().map(org => option(org.id, org.name, user.orgId)).join('')), 'usuario');
    }
    function editPlan(planId) {
      const plan = BLK.data.plans.find(row => row.id === planId) || {};
      recordModal('plan', planId, input('name', 'Nombre', plan.name, 'text', true, 100) + input('price', 'Precio mensual (€); vacío = consultar', plan.price ?? '', 'number'), 'plan');
    }
    function editPolicy(policyId) {
      const policy = BLK.data.policies.find(row => row.id === policyId) || { enabled: true };
      recordModal('policy', policyId, input('name', 'Nombre', policy.name, 'text', true) + `<div class="form-group"><label class="form-label" for="record-description">Descripción</label><textarea class="form-input" style="height:120px;padding:10px" id="record-description" name="description" maxlength="3000">${esc(policy.description)}</textarea></div><label><input name="enabled" type="checkbox" ${policy.enabled ? 'checked' : ''}> Habilitada (configuración informativa)</label>`, 'política');
    }
    $('recordForm').addEventListener('submit', event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), values = Object.fromEntries(form.entries());
      if (!editor) return;
      const save = () => {
        if (editor.type === 'user') BLK.saveUser(editor.id, values);
        else if (editor.type === 'plan') BLK.savePlan(editor.id, { ...values, price: values.price === '' ? null : Number(values.price) });
        else BLK.savePolicy(editor.id, { ...values, enabled: form.has('enabled') });
      };
      if (perform(save, 'Registro guardado.')) closeModal('recordModal');
    });
    function removeUser(id) { if (confirm('¿Eliminar este usuario?')) perform(() => BLK.deleteUser(id), 'Usuario eliminado.'); }
    function removePlan(id) { if (confirm('¿Eliminar este plan?')) perform(() => BLK.deletePlan(id), 'Plan eliminado.'); }
    function removePolicy(id) { if (confirm('¿Eliminar esta política?')) perform(() => BLK.deletePolicy(id), 'Política eliminada.'); }
    function exportJson() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(BLK.exportData(), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'tektonik-hub-data.json'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('JSON exportado con los cambios locales.');
    }
    function refreshSuperadmin() {
      renderTable(); Object.keys(titles).forEach(renderPanel);
      const data = BLK.data, orgs = BLK.organizations();
      const values = [orgs.filter(org => ['active', 'active-amber'].includes(org.status)).length, data.apps.filter(app => app.reviewStatus === 'approved').length, data.apps.filter(app => app.reviewStatus === 'pending_review').length, 'DEMO'];
      document.querySelectorAll('#panel-dashboard .kpi-value').forEach((el, index) => el.textContent = values[index]);
      document.querySelectorAll('#panel-dashboard .kpi-sub').forEach(el => el.textContent = 'Derivado del dataset local; no telemetría real');
      document.querySelectorAll('.nav-item .nav-badge, .badge-dot').forEach(el => {
        el.textContent = orgs.filter(org => org.status === (el.closest('[data-panel]')?.dataset.panel === 'suspended-orgs' ? 'suspended' : 'pending')).length;
      });
      if ($('orgDetailModal').classList.contains('open')) {
        const org = orgs.find(row => row.id === selectedOrgId);
        if (org) openOrgDetail(org); else closeModal('orgDetailModal');
      }
    }
    document.querySelectorAll('.nav-item[data-panel]').forEach(btn => btn.addEventListener('click', () => showPanel(btn.dataset.panel)));
    document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(overlay.id); }));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(el => closeModal(el.id)); });
    Object.assign(window, { refreshSuperadmin, renderTable, filterTable, setFilter, showPanel, searchPanel, openModal, closeModal, openOrgDetail, editOrg, selectOrgAdmin, createOrg, deleteOrg, suspendOrg, openReactivate, accessOrg, editUser, editPlan, editPolicy, removeUser, removePlan, removePolicy, exportJson, showToast });
    BLK.subscribe(refreshSuperadmin); refreshSuperadmin();
  }).catch(BLK.showError);
})();
