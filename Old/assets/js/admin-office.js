(() => {
  'use strict';
  BLK.ready.then(() => {
    const $ = id => document.getElementById(id);
    const esc = BLK.escape;
    const statuses = BLK.config.statusLabels;
    let editor = null, returnFocus = null;
    const canManage = () => ['admin', 'superadmin'].includes(BLK.currentUser().role);
    const findApp = id => BLK.apps({ includeUnpublished: true }).find(app => app.id === id);
    const action = (type, id, label, danger = false) => `<button type="button" class="btn-act ${danger ? 'btn-reject' : 'btn-changes'}" data-office-action="${type}" data-id="${esc(id)}">${esc(label)}</button>`;
    const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
    function render() {
      const data = BLK.data;
      const query = $('office-search').value.trim().toLocaleLowerCase('es');
      const status = $('office-status').value;
      const manage = canManage();
      $('office-new-app').hidden = !manage;
      $('office-new-policy').hidden = !manage;
      const apps = BLK.apps({ includeUnpublished: true }).filter(app => (!status || app.reviewStatus === status) && `${app.title} ${app.desc} ${data.users.find(user => user.id === app.authorId)?.name || ''}`.toLocaleLowerCase('es').includes(query));
      $('office-apps').innerHTML = apps.map(app => {
        const author = data.users.find(user => user.id === app.authorId);
        const area = BLK.categories.find(category => category.id === app.area)?.label || app.area;
        const stateClass = app.reviewStatus === 'approved' ? 'approved' : app.reviewStatus === 'rejected' ? 'rejected' : 'waiting';
        return `<article class="review-card" data-app-id="${esc(app.id)}"><div class="card-top"><div class="author-info"><div class="author-avatar">${esc(author?.initials)}</div><div><div class="author-name">${esc(author?.name)}</div><div class="author-sub">${esc(author?.dept)}</div></div></div><span class="status-stamp ${stateClass}">${esc(statuses[app.reviewStatus])}</span></div><div class="app-title">${esc(app.title)} <span class="cat-chip">${esc(area)}</span></div><p class="app-desc">${esc(app.desc)}</p><div class="meta-row"><span>${esc(app.ticket)} · v${app.version}</span><span>IA: ${esc(app.tech.join(', ') || '—')}</span></div><div class="card-actions">${action('details', app.id, 'Detalles e historial')}${manage ? action('edit-app', app.id, 'Editar') + action('delete-app', app.id, 'Eliminar', true) : ''}${manage && app.reviewStatus === 'pending_review' ? action('approve', app.id, 'Aprobar') + action('reject', app.id, 'Rechazar', true) + action('changes', app.id, 'Solicitar cambios') : ''}</div></article>`;
      }).join('') || '<p>No hay aplicaciones para estos filtros.</p>';
      $('office-policies').innerHTML = BLK.governancePolicies().map(policy => `<article class="review-card" data-policy-id="${esc(policy.id)}"><div class="app-title">${esc(policy.name)} <span class="cat-chip">${policy.orgId ? 'Organización' : 'Global · solo lectura'}</span></div><p class="app-desc">${esc(policy.description || 'Sin descripción')}</p><span class="status-stamp ${policy.enabled ? 'approved' : 'waiting'}">${policy.enabled ? 'Habilitada' : 'Deshabilitada'}</span>${manage && policy.orgId === BLK.currentOrg().id ? `<div class="card-actions">${action('edit-policy', policy.id, 'Editar')}${action('delete-policy', policy.id, 'Eliminar', true)}</div>` : ''}</article>`).join('') || '<p>No hay políticas de gobernanza. Crea la primera para tu organización.</p>';
    }
    function field(name, label, value = '', type = 'text', max = 120, min = 0) {
      const control = type === 'textarea' ? `<textarea class="form-textarea" name="${name}" maxlength="${max}" minlength="${min}"${min ? ' required' : ''}>${esc(value)}</textarea>` : `<input class="form-input" name="${name}" type="${type}" value="${esc(value)}"${type === 'number' ? ' min="0" step="1" required' : ` maxlength="${max}"${min ? ' required' : ''}`}>`;
      return `<label>${esc(label)}${control}</label>`;
    }
    function showDialog(title, fields, saveLabel = 'Guardar') {
      returnFocus = document.activeElement;
      $('office-dialog-title').textContent = title;
      $('office-fields').innerHTML = fields;
      $('office-form-error').textContent = '';
      $('office-save').hidden = !saveLabel;
      $('office-save').textContent = saveLabel || 'Guardar';
      $('office-cancel').textContent = saveLabel ? 'Cancelar' : 'Cerrar';
      $('office-dialog').showModal();
    }
    function editApp(id) {
      const app = id ? findApp(id) : null;
      if (id && !app) return;
      const orgId = BLK.currentOrg().id;
      editor = { type: 'app', id: app?.id || null, version: app?.version, orgId, snapshot: app };
      const authors = BLK.data.users.filter(user => user.orgId === orgId && user.role === 'developer');
      showDialog(app ? 'Editar aplicación' : 'Nueva aplicación',
        '<p class="office-note">Al guardar, la aplicación queda pendiente y deja de estar publicada hasta una nueva aprobación. Se conserva el historial.</p>' +
        field('title', 'Título', app?.title, 'text', 60, 1) + field('desc', 'Descripción (mínimo 30 caracteres)', app?.desc, 'textarea', 800, 30) +
        `<label>Área<select class="form-select" name="area" required>${option('', 'Selecciona un área', app?.area)}${BLK.categories.map(category => option(category.id, category.label, app?.area)).join('')}</select></label>` +
        `<label>Creador<select class="form-select" name="authorId" required>${option('', 'Selecciona un creador', app?.authorId)}${authors.map(user => option(user.id, user.name, app?.authorId)).join('')}</select></label>` +
        field('aiTool', 'Tecnología principal', app?.tech[0], 'text', 100) + field('repoUrl', 'Repositorio (HTTP/HTTPS)', app?.repoUrl, 'url', 1000) +
        field('impact', 'Impacto estimado', app?.impact, 'text', 500) + field('dataNote', 'Nota de datos y riesgos', app?.dataNote, 'textarea', 2000));
    }
    function editPolicy(id) {
      const policy = id ? BLK.governancePolicies().find(row => row.id === id && row.orgId === BLK.currentOrg().id) : null;
      if (id && !policy) return;
      editor = { type: 'policy', id: policy?.id || null, version: policy?.version, orgId: BLK.currentOrg().id };
      showDialog(policy ? 'Editar política' : 'Nueva política', field('name', 'Nombre', policy?.name, 'text', 120, 1) + field('description', 'Descripción', policy?.description, 'textarea', 3000) + `<label class="office-check"><input name="enabled" type="checkbox"${!policy || policy.enabled ? ' checked' : ''}>Habilitada (informativa)</label>`);
    }
    function details(id) {
      const app = findApp(id); if (!app) return;
      editor = null;
      const users = BLK.data.users;
      const reviews = BLK.reviews(id);
      let repo = '';
      try { const url = new URL(app.repoUrl); if (['http:', 'https:'].includes(url.protocol)) repo = `<p>Repositorio: <a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(url.href)}</a></p>`; } catch { /* Repositorio opcional. */ }
      showDialog('Detalles e historial', `<h4>${esc(app.title)}</h4><p class="app-desc">${esc(app.desc)}</p><p>${esc(statuses[app.reviewStatus])} · ${esc(app.ticket)} · v${app.version}</p>${repo}<p>Impacto: ${esc(app.impact || 'Sin estimación')}</p><p>Nota de datos: ${esc(app.dataNote || 'Sin nota')}</p><p>Adjuntos (solo metadatos): ${esc(app.attachments.map(file => file.name).join(', ') || 'Sin adjuntos')}</p><h4>Historial de revisión</h4>${reviews.length ? `<ol class="office-history">${reviews.map(review => `<li><b>${esc(statuses[review.action])}</b> · v${esc(review.version)}<br>${esc(users.find(user => user.id === review.reviewerId)?.name || 'Revisor')} · ${esc(new Date(review.createdAt).toLocaleString('es-ES'))}<br>${esc(review.reason || 'Sin comentarios')}${review.environment ? `<br>Entorno: ${esc(review.environment)}` : ''}</li>`).join('')}</ol>` : '<p>Sin decisiones registradas.</p>'}`, null);
    }
    function deleteRecord(type, id) {
      const record = type === 'app' ? findApp(id) : BLK.governancePolicies().find(row => row.id === id && row.orgId === BLK.currentOrg().id);
      if (!record) return;
      editor = { type: 'delete-' + type, id, version: record.version, orgId: BLK.currentOrg().id };
      showDialog('Confirmar eliminación', `<p>¿Eliminar «${esc(record.title || record.name)}»?</p><p>Esta acción no se puede deshacer.${type === 'app' ? ' También se eliminarán sus revisiones y eventos vinculados y desaparecerá del catálogo.' : ''}</p>`, 'Eliminar');
    }
    $('office-form').addEventListener('submit', event => {
      event.preventDefault(); if (!editor) return;
      try {
        if (!canManage() || editor.orgId !== BLK.currentOrg().id) throw new Error('La identidad de demo cambió. Vuelve a abrir el formulario.');
        const fields = Object.fromEntries(new FormData(event.currentTarget));
        if (editor.type === 'app') BLK.saveManagedApp(editor.id, { ...editor.snapshot, ...fields, orgId: editor.orgId, hours: editor.snapshot?.metrics?.hours || 0, users: editor.snapshot?.metrics?.users || 0 }, editor.version);
        else if (editor.type === 'policy') BLK.saveGovernancePolicy(editor.id, { ...fields, enabled: event.currentTarget.elements.enabled.checked }, editor.version);
        else if (editor.type === 'delete-app') BLK.deleteManagedApp(editor.id, editor.version);
        else BLK.deleteGovernancePolicy(editor.id, editor.version);
        $('office-dialog').close();
        window.showToast('Cambios guardados en este navegador.');
      } catch (error) { $('office-form-error').textContent = error.message; }
    });
    $('office-cancel').addEventListener('click', () => $('office-dialog').close());
    $('office-dialog').addEventListener('close', () => { editor = null; if (returnFocus?.isConnected) returnFocus.focus(); else $('btn-office').focus(); });
    $('office-new-app').addEventListener('click', () => editApp());
    $('office-new-policy').addEventListener('click', () => editPolicy());
    $('office-search').addEventListener('input', render);
    $('office-status').addEventListener('change', render);
    $('view-office').addEventListener('click', event => {
      const button = event.target.closest('[data-office-action]'); if (!button) return;
      const id = button.dataset.id, type = button.dataset.officeAction;
      if (type === 'details') { details(id); return; }
      if (!canManage()) return;
      if (type === 'edit-app') editApp(id);
      else if (type === 'edit-policy') editPolicy(id);
      else if (type.startsWith('delete-')) deleteRecord(type.slice(7), id);
      else {
        const app = findApp(id); if (!app) return;
        ({ approve: window.openApproveModal, reject: window.openRejectModal, changes: window.openChangesModal })[type]?.(id, app.title);
      }
    });
    BLK.subscribe(render); render();
  }).catch(BLK.showError);
})();
