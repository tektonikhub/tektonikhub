(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const engine = window.BLKStudioEngine;
  const kit = window.BLKDashboardKit;
  let llmConfigured = false, llmChecking = false, llmStatusMessage = 'Comprobando servidor…';
  const azureMode = () => $('generationMode').value === 'azure';
  function renderMode() {
    $('generationMode').disabled = busy || !ready;
    $('azureModeOption').disabled = !llmConfigured;
    $('llmRefresh').disabled = busy || llmChecking;
    $('agentModeLabel').textContent = azureMode() ? 'Tektonik hub Agent · Azure OpenAI' : 'Tektonik hub Agent · demo local';
    $('modelLabel').textContent = azureMode() ? 'Azure · configuración JSON → HTML' : 'Motor demo · sin conexión a IA';
    $('modeNote').textContent = llmConfigured ? (azureMode() ? 'IA real para dashboards. Datos ficticios; cada petición consume cuota de Azure.' : 'Demo local activa. Azure disponible si cambias el motor.') : llmStatusMessage;
  }
  async function refreshLLM() {
    if (llmChecking || busy) return;
    llmChecking = true; if (ready) renderMode();
    try {
      const result = await BLKLLM.status(); llmConfigured = result.configured;
      llmStatusMessage = result.configured ? 'Azure disponible.' : 'Servidor disponible. Configura Azure desde el administrador.';
    } catch (error) { llmConfigured = false; llmStatusMessage = error.message; }
    finally { llmChecking = false; if (ready) refreshControls(); }
  }
  function dashboardSpec(base, config) {
    return { ...base, kind: 'dashboard', title: config.title, description: config.description, dark: config.theme.dark, accent: config.theme.accent, dashboard: config };
  }
  const MAX_VERSIONS = 8;
  const MAX_MESSAGES = 40;
  let draft, draftKey, editing = null, busy = false, job = null, view = 'preview', ready = false, toastTimer;
  const blank = () => ({ schemaVersion: 1, messages: [], versions: [], selectedId: null, nextVersion: 1, submission: null });
  const current = () => draft.versions.find(version => version.id === draft.selectedId);
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4500);
  }
  function persist() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
      $('saveState').textContent = '✓ Guardado en este navegador';
      return true;
    } catch (error) {
      $('saveState').textContent = 'Sin guardar · exporta tu HTML';
      toast('No se pudo guardar el borrador. Sigue en memoria; exporta tu HTML antes de salir.');
      return false;
    }
  }
  function loadDraft() {
    const raw = localStorage.getItem(draftKey);
    if (!raw) return null;
    if (raw.length > 3000000) throw new Error('Borrador demasiado grande');
    const saved = JSON.parse(raw);
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.versions) || saved.versions.length > MAX_VERSIONS || !Array.isArray(saved.messages) || saved.messages.length > MAX_MESSAGES || !Number.isInteger(saved.nextVersion) || saved.nextVersion < 1) throw new Error('Borrador no compatible');
    for (const version of saved.versions) {
      if (!Number.isInteger(version.id) || typeof version.html !== 'string' || version.html.length > 300000 || typeof version.spec?.title !== 'string' || typeof version.spec?.kind !== 'string') throw new Error('Versión inválida');
      if (version.spec.dashboard) version.spec.dashboard = kit.validate(version.spec.dashboard);
      if (version.provider && !['demo', 'azure-openai'].includes(version.provider)) throw new Error('Motor desconocido');
      if (version.model && (typeof version.model !== 'string' || version.model.length > 128)) throw new Error('Modelo inválido');
    }
    for (const message of saved.messages) if (!['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || message.text.length > 4000) throw new Error('Conversación inválida');
    if (saved.selectedId !== null && !saved.versions.some(version => version.id === saved.selectedId)) throw new Error('Versión seleccionada inexistente');
    if (saved.submission && (typeof saved.submission.id !== 'string' || typeof saved.submission.ticket !== 'string')) throw new Error('Ticket inválido');
    return saved;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }
  function messageNode(message) {
    const article = document.createElement('article');
    article.className = `message ${message.role}`;
    const label = document.createElement('div');
    label.className = 'message-label';
    const glyph = document.createElement('span');
    glyph.className = 'mini-glyph'; glyph.textContent = '✦';
    label.append(glyph, document.createTextNode(message.role === 'user' ? 'Tú' : 'Tektonik hub Agent'));
    const text = document.createElement('p'); text.textContent = message.text;
    article.append(label, text);
    if (message.versionId && draft.versions.some(version => version.id === message.versionId)) {
      const button = document.createElement('button'); button.className = 'artifact';
      const file = document.createElement('span'); file.className = 'artifact-icon'; file.appendChild(icon('code'));
      const info = document.createElement('span');
      const title = document.createElement('b'); title.textContent = 'index.html';
      const caption = document.createElement('small'); caption.textContent = `Versión ${message.versionId} · Abrir preview`;
      info.append(title, caption); button.append(file, info, icon('chevron'));
      button.onclick = () => { if (!busy) { selectVersion(message.versionId); setView('preview'); setMobileView('preview'); } };
      article.appendChild(button);
    }
    $('chatLog').appendChild(article);
    return article;
  }
  function addMessage(role, text, versionId) {
    const message = { role, text, ...(versionId ? { versionId } : {}) };
    draft.messages.push(message);
    if (draft.messages.length > MAX_MESSAGES) draft.messages.shift();
    messageNode(message);
    scrollChat();
  }
  function scrollChat() { $('chatLog').scrollTop = $('chatLog').scrollHeight; }
  function renderConversation() {
    $('chatLog').querySelectorAll('.message:not(:first-child)').forEach(node => node.remove());
    draft.messages.forEach(messageNode);
    scrollChat();
  }
  function isolatedHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = doc.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
    doc.head.prepend(meta);
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }
  function setView(next) {
    view = next;
    const hasVersion = !!current();
    $('previewTab').setAttribute('aria-selected', next === 'preview');
    $('codeTab').setAttribute('aria-selected', next === 'code');
    $('previewTab').tabIndex = next === 'preview' ? 0 : -1;
    $('codeTab').tabIndex = next === 'code' ? 0 : -1;
    $('codePanel').hidden = next !== 'code';
    $('previewPanel').hidden = next !== 'preview' || !hasVersion;
    $('emptyState').hidden = next !== 'preview' || hasVersion;
    $('generationOverlay').hidden = !busy || next !== 'preview';
  }
  function setMobileView(next) {
    $('studioBody').dataset.mobileView = next;
    document.querySelectorAll('[data-mobile-view]').forEach(button => {
      if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', button.dataset.mobileView === next);
    });
  }
  function refreshControls() {
    const version = current();
    const disabled = !version || busy;
    ['downloadButton', 'copyButton', 'refreshButton'].forEach(id => $(id).disabled = disabled);
    $('reviewButton').disabled = disabled || !!draft.submission;
    $('reviewButton').querySelector('span').textContent = draft.submission ? 'Enviado a IT' : 'Enviar a IT';
    $('versionSelect').disabled = disabled;
    $('promptInput').disabled = !ready || busy;
    $('sendButton').disabled = !ready || (!busy && (!$('promptInput').value.trim() || (azureMode() && !llmConfigured)));
    $('sendButton').setAttribute('aria-label', busy ? 'Detener generación' : 'Generar herramienta');
    $('sendButton').title = busy ? 'Detener generación' : 'Generar herramienta';
    $('sendButton').replaceChildren(icon(busy ? 'close' : 'send'));
    $('newProjectButton').disabled = busy;
    document.querySelectorAll('[data-prompt]').forEach(button => button.disabled = !ready || busy);
    $('quickEdits').hidden = !version;
    $('projectName').textContent = version?.spec.title || editing?.title || 'Proyecto sin título';
    $('projectName').title = $('projectName').textContent;
    renderMode();
  }
  function renderVersion() {
    const version = current();
    $('versionSelect').replaceChildren();
    if (!draft.versions.length) $('versionSelect').add(new Option('Sin versiones', ''));
    for (const item of [...draft.versions].reverse()) $('versionSelect').add(new Option(`v${item.id} · ${item.spec.dark ? 'Oscuro' : 'Claro'}`, item.id));
    if (version) {
      $('versionSelect').value = String(version.id);
      $('previewFrame').srcdoc = isolatedHTML(version.html);
      $('codeContent').textContent = version.html;
      $('codeSize').textContent = `${(new Blob([version.html]).size / 1024).toFixed(1)} KB`;
      $('previewUrl').textContent = `preview.local / ${version.spec.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      $('engineStatus').textContent = `✓ v${version.id} lista · ${version.provider === 'azure-openai' ? 'Azure OpenAI' : 'demo local'} · index.html`;
    } else {
      $('previewFrame').removeAttribute('srcdoc');
      $('codeContent').textContent = '// El HTML de tu herramienta aparecerá aquí.';
      $('codeSize').textContent = '0 KB';
      $('previewUrl').textContent = 'preview.local / tu-herramienta';
      $('engineStatus').textContent = 'Listo para tu primera idea';
    }
    setView(view); refreshControls();
  }
  function selectVersion(id) {
    if (!draft.versions.some(version => version.id === id)) return;
    draft.selectedId = id; renderVersion(); persist();
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('Detenido', 'AbortError'));
      const abort = () => { clearTimeout(timer); reject(new DOMException('Detenido', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  async function generate(prompt) {
    prompt = prompt.trim();
    if (!prompt || busy || !ready) return;
    if (prompt.length > 2000) return toast('Describe tu idea en un máximo de 2000 caracteres.');
    const previous = current()?.spec || null;
    const useAzure = azureMode();
    if (useAzure && !llmConfigured) return toast('Configura Azure en Admin → LLM Settings. No se cambia automáticamente al modo demo.');
    busy = true; job = new AbortController();
    const signal = job.signal;
    addMessage('user', prompt);
    $('promptInput').value = ''; $('promptCounter').textContent = '0 / 2000';
    refreshControls(); setView(view);
    const activity = messageNode({ role: 'assistant', text: previous ? 'Voy a iterar sobre la versión que estás viendo.' : 'Voy a convertir tu idea en un primer prototipo.' });
    const steps = useAzure ? ['Azure está componiendo el dashboard', 'Validar componentes y renderizar HTML', 'Mostrar el HTML completo progresivamente', 'Montar preview aislada'] : ['Interpretar la petición · motor demo', 'Preparar estructura y estilos', 'Generar index.html', 'Montar preview aislada'];
    const list = document.createElement('ol'); list.className = 'activity';
    const rows = steps.map(text => { const row = document.createElement('li'); const dot = document.createElement('span'); dot.className = 'step-dot'; row.append(dot, document.createTextNode(text)); list.appendChild(row); return row; });
    activity.appendChild(list);
    $('engineStatus').textContent = useAzure ? 'Esperando respuesta de Azure · sin streaming de tokens' : 'Generando · demo local';
    try {
      let spec, html, model;
      const provider = useAzure ? 'azure-openai' : 'demo';
      for (let step = 0; step < steps.length; step++) {
        if (step > 0) { rows[step - 1].className = 'done'; rows[step - 1].firstChild.textContent = '✓'; }
        rows[step].className = 'active';
        $('generationTitle').textContent = steps[step];
        $('generationProgress').style.width = `${(step + 1) * 25}%`;
        scrollChat();
        if (step === 0) {
          spec = engine.createSpec(prompt, previous);
          if (useAzure) {
            if (spec.kind !== 'dashboard' || engine.createSpec(prompt).kind !== 'dashboard') throw new Error('El modo Azure de este MVP crea dashboards. Para calculadoras, formularios o kanban usa el modo demo');
            const result = await BLKLLM.generate(prompt, previous?.dashboard || null, signal);
            spec = dashboardSpec(spec, kit.validate(result.config)); model = result.model;
          } else if (spec.kind === 'dashboard') spec = dashboardSpec(spec, kit.createConfig(prompt, previous?.dashboard || null));
        }
        if (step === 1) {
          html = spec.dashboard ? kit.renderHTML(spec.dashboard) : engine.renderHTML(spec);
          if (spec.dashboard) html = html.replace(/<body\b/i, `<body data-theme="${spec.dark ? 'dark' : 'light'}"`);
          html = html.replace('</head>', `<meta name="blk-generator" content="${provider}"><meta name="blk-model" content="${BLK.escape(model || '')}"></head>`);
          if (html.length > 300000) throw new Error('El HTML supera el límite del prototipo');
        }
        if (step === 2) {
          $('codeContent').textContent = '';
          const chunk = Math.ceil(html.length / 14);
          for (let end = chunk; end < html.length + chunk; end += chunk) {
            await wait(65, signal);
            $('codeContent').textContent = html.slice(0, end);
            if (view === 'code') $('codePanel').scrollTop = $('codePanel').scrollHeight;
          }
        } else await wait(450, signal);
      }
      rows.at(-1).className = 'done'; rows.at(-1).firstChild.textContent = '✓';
      const version = { id: draft.nextVersion++, spec, html, provider, ...(model ? { model } : {}), createdAt: new Date().toISOString() };
      draft.versions.push(version);
      if (draft.versions.length > MAX_VERSIONS) draft.versions.shift();
      draft.selectedId = version.id;
      activity.remove();
      const explanation = useAzure ? `He compuesto «${spec.title}» con Azure OpenAI (${model}): ${spec.dashboard.components.length} componentes validados sobre datos ficticios. El HTML lo genera el renderer de Tektonik hub, no ejecutamos código del modelo.` : `${engine.explainChanges(previous, spec)} Esta versión usa plantillas/componentes locales, no IA real.`;
      addMessage('assistant', `${explanation}\n\nPuedes probarla en el preview o pedirme un cambio.`, version.id);
      persist();
    } catch (error) {
      activity.remove();
      addMessage('assistant', error.name === 'AbortError' ? 'Generación detenida. La última versión completa sigue intacta; puedes probar otra petición.' : `No pude construir esta versión: ${error.message}. Tu versión anterior se conserva.`);
      persist();
    } finally {
      busy = false; job = null;
      renderVersion();
      $('codePanel').scrollTop = 0;
      $('promptInput').focus();
    }
  }
  function download() {
    const version = current(); if (!version || busy) return;
    const url = URL.createObjectURL(new Blob([version.html], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'index.html'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('HTML exportado. Es un prototipo local con datos ficticios.');
  }
  async function copyHTML() {
    if (!current() || busy) return;
    try { await navigator.clipboard.writeText(current().html); toast('HTML copiado al portapapeles.'); }
    catch { setView('code'); toast('No se pudo copiar. Selecciona el código o exporta el HTML.'); }
  }
  function openReview() {
    const version = current(); if (!version || busy || draft.submission) return;
    $('reviewForm').hidden = false; $('reviewSuccess').hidden = true; $('reviewError').hidden = true;
    $('reviewName').value = version.spec.title.slice(0, 60);
    const description = draft.messages.find(message => message.role === 'user')?.text || editing?.desc || version.spec.description;
    $('reviewDescription').value = `${description}\n\nPrototipo HTML generado en Tektonik hub Studio, con datos ficticios y sin conexiones corporativas.`.slice(0, 800);
    const area = editing?.area || version.spec.area;
    $('reviewArea').value = BLK.categories.some(category => category.id === area) ? area : BLK.categories[0].id;
    $('reviewDialog').showModal();
  }
  function sendReview(event) {
    event.preventDefault();
    if (!current() || busy || draft.submission) return;
    const version = current();
    try {
      const attachments = (editing?.attachments || []).filter(file => file.name !== 'index.html');
      if (attachments.length < BLK.config.upload.maxFiles) attachments.push({ name: 'index.html', type: 'text/html', size: new Blob([version.html]).size });
      const fields = {
        title: $('reviewName').value, desc: $('reviewDescription').value, area: $('reviewArea').value,
        aiTool: version.provider === 'azure-openai' ? 'Tektonik hub Studio · Azure OpenAI' : 'Tektonik hub Studio · motor demo local', generatedHtml: version.html,
        dataNote: version.provider === 'azure-openai' ? 'Datos ficticios. Composición JSON con Azure OpenAI y renderer de componentes BLK. Sin SSO, conexiones corporativas ni certificación de seguridad.' : 'Datos ficticios. Generación por plantillas locales; sin LLM, SSO, integraciones ni certificación de seguridad.',
        attachments
      };
      const app = editing ? BLK.updateSubmission(editing.id, fields, editing.version) : BLK.createSubmission(fields);
      draft.submission = { id: app.id, ticket: app.ticket, versionId: version.id };
      addMessage('assistant', `Versión ${version.id} enviada a revisión de IT.\nTicket: ${app.ticket}\nAún no está publicada. Puedes consultar su estado en tu perfil.`);
      persist(); refreshControls();
      $('reviewForm').hidden = true;
      $('reviewSuccess').replaceChildren();
      const text = document.createElement('p'); text.textContent = `✓ Envío guardado · ${app.ticket}`;
      const link = document.createElement('a'); link.href = 'profile.html'; link.textContent = 'Ver mis envíos →';
      $('reviewSuccess').append(text, link); $('reviewSuccess').hidden = false;
    } catch (error) { $('reviewError').textContent = error.message; $('reviewError').hidden = false; }
  }
  function newProject() {
    try { localStorage.removeItem(draftKey); }
    catch { return toast('No se pudo borrar el borrador local. No se ha reiniciado el proyecto.'); }
    history.replaceState(null, '', 'create-app.html');
    editing = null;
    draftKey = `blkunit:studio:v1:${BLK.currentOrg().id}:${BLK.currentUser().id}:new`;
    draft = blank(); renderConversation(); renderVersion();
    $('promptInput').value = ''; $('promptCounter').textContent = '0 / 2000';
    $('newProjectDialog').close(); persist(); refreshControls(); $('promptInput').focus();
  }
  $('generationMode').addEventListener('change', () => { refreshControls(); });
  $('llmRefresh').onclick = refreshLLM;
  window.addEventListener('focus', refreshLLM);
  $('promptForm').addEventListener('submit', event => { event.preventDefault(); if (busy) job?.abort(); else generate($('promptInput').value); });
  $('promptInput').addEventListener('input', () => { $('promptCounter').textContent = `${$('promptInput').value.length} / 2000`; if (ready) refreshControls(); });
  $('promptInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('promptForm').requestSubmit(); } });
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { setMobileView('preview'); generate(button.dataset.prompt); }));
  document.querySelectorAll('button[data-mobile-view]').forEach(button => button.addEventListener('click', () => setMobileView(button.dataset.mobileView)));
  $('previewTab').onclick = () => setView('preview'); $('codeTab').onclick = () => setView('code');
  document.querySelector('.tabs').addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setView(event.key === 'Home' ? 'preview' : event.key === 'End' ? 'code' : view === 'preview' ? 'code' : 'preview'); $(view === 'preview' ? 'previewTab' : 'codeTab').focus(); } });
  $('desktopButton').onclick = () => { $('previewStage').classList.remove('mobile'); $('desktopButton').setAttribute('aria-pressed', true); $('mobileButton').setAttribute('aria-pressed', false); };
  $('mobileButton').onclick = () => { $('previewStage').classList.add('mobile'); $('desktopButton').setAttribute('aria-pressed', false); $('mobileButton').setAttribute('aria-pressed', true); };
  $('versionSelect').onchange = () => selectVersion(Number($('versionSelect').value));
  $('refreshButton').onclick = () => { if (current() && !busy) { $('previewFrame').srcdoc = isolatedHTML(current().html); toast('Preview reiniciada; los datos de prueba vuelven a su estado inicial.'); } };
  $('downloadButton').onclick = download; $('copyButton').onclick = copyHTML;
  $('stopButton').onclick = () => job?.abort();
  $('reviewButton').onclick = openReview; $('reviewForm').onsubmit = sendReview;
  ['closeReviewButton', 'cancelReviewButton'].forEach(id => $(id).onclick = () => $('reviewDialog').close());
  $('newProjectButton').onclick = () => $('newProjectDialog').showModal();
  $('cancelNewButton').onclick = () => $('newProjectDialog').close(); $('confirmNewButton').onclick = newProject;
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  window.BLK.ready.then(() => {
    if (!engine || !kit) throw new Error('No se ha cargado el motor de generación o el catálogo de componentes.');
    const editId = new URLSearchParams(location.search).get('edit');
    if (editId) {
      editing = BLK.apps({ authorId: BLK.currentUser().id, includeUnpublished: true }).find(app => app.id === editId);
      if (!editing || editing.reviewStatus !== 'changes_requested') throw new Error('Solo puedes editar tus envíos con cambios solicitados.');
    }
    draftKey = `blkunit:studio:v1:${BLK.currentOrg().id}:${BLK.currentUser().id}:${editId || 'new'}`;
    draft = blank();
    let restored = false;
    try { const saved = loadDraft(); if (saved) { draft = saved; restored = true; } }
    catch { toast('El borrador local no es compatible. Puedes iniciar uno nuevo con el botón +.'); $('saveState').textContent = 'No se pudo restaurar'; }
    if (editing && !restored) {
      draft.messages.push({ role: 'assistant', text: `IT ha solicitado cambios en ${editing.title}. Conservamos el ticket ${editing.ticket}. Pídeme una modificación y vuelve a enviarla.` });
      if (editing.generatedHtml) {
        const document = new DOMParser().parseFromString(editing.generatedHtml, 'text/html');
        let spec = { ...engine.createSpec(editing.desc), title: editing.title };
        const embedded = document.getElementById('blk-dashboard-config');
        if (embedded) {
          try { spec = dashboardSpec(spec, kit.validate({ ...JSON.parse(embedded.textContent), title: editing.title })); }
          catch { toast('No se pudo recuperar la configuración del dashboard. Se conserva el HTML original.'); }
        }
        const provider = document.querySelector('meta[name="blk-generator"]')?.content === 'azure-openai' ? 'azure-openai' : 'demo';
        const model = document.querySelector('meta[name="blk-model"]')?.content.slice(0, 128) || '';
        draft.versions.push({ id: 1, spec, html: editing.generatedHtml, provider, model, createdAt: editing.updatedAt }); draft.selectedId = 1; draft.nextVersion = 2;
      } else $('promptInput').value = editing.desc.slice(0, 2000);
    }
    BLK.categories.forEach(category => $('reviewArea').add(new Option(category.label, category.id)));
    $('userAvatar').textContent = BLK.currentUser().initials;
    ready = true; renderConversation(); renderVersion(); refreshLLM();
    if (restored) $('saveState').textContent = '✓ Borrador restaurado';
  }).catch(window.BLK.showError);
})();
