(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let busy = false, configured = false, available = false, revision = 0;
  const authorized = () => ['admin', 'superadmin'].includes(BLK.currentUser().role);
  function status(message, error = false) { $('llmStatus').textContent = message; $('llmStatus').dataset.error = String(error); }
  function controls() {
    $('llmFields').disabled = busy || !available || !authorized();
    $('llmTest').disabled = busy || !configured;
    $('llmClear').disabled = busy || !configured;
    $('llmApiKey').required = !configured;
  }
  function apply(result) {
    available = true; configured = result.configured;
    $('llmEndpoint').value = result.endpoint;
    $('llmDeployment').value = result.deployment;
    $('llmApiVersion').value = result.apiVersion;
    $('llmApiKey').placeholder = configured ? 'Guardada en servidor. Déjala vacía para conservarla.' : 'Introduce tu clave';
    controls();
  }
  async function refresh() {
    if (busy) return;
    const current = ++revision;
    try {
      const result = await BLKLLM.status(); if (current !== revision) return;
      apply(result);
      status(!authorized() ? 'Selecciona el rol Admin de demostración para configurar el LLM. No es autenticación real.' : configured ? 'Azure configurado en memoria para esta organización. La prueba de conexión consume una petición.' : 'Servidor local disponible. Introduce la configuración de Azure OpenAI.');
    } catch (error) { if (current !== revision) return; available = false; configured = false; controls(); status(error.message, true); }
  }
  async function perform(operation, message) {
    if (busy || !authorized()) return;
    const organization = BLK.currentOrg().id;
    busy = true; revision++; controls(); status(message);
    try {
      const result = await operation();
      if (organization !== BLK.currentOrg().id) return;
      if (result.available) apply(result);
      status(result.message || (result.configured ? 'Credenciales guardadas solo en memoria del servidor. Ya puedes generar dashboards con Azure.' : 'Credenciales eliminadas del servidor.'));
    } catch (error) { status(error.message, true); }
    finally { $('llmApiKey').value = ''; busy = false; controls(); if (organization !== BLK.currentOrg().id) refresh(); }
  }
  window.BLKLLMSettings = { refresh };
  BLK.ready.then(() => {
    $('llmForm').addEventListener('submit', event => {
      event.preventDefault();
      const fields = { endpoint: $('llmEndpoint').value.trim(), deployment: $('llmDeployment').value.trim(), apiVersion: $('llmApiVersion').value.trim(), apiKey: $('llmApiKey').value.trim() };
      $('llmApiKey').value = '';
      perform(() => BLKLLM.save(fields), 'Guardando en el servidor local…');
    });
    $('llmTest').addEventListener('click', () => perform(() => BLKLLM.test(), 'Probando conexión y JSON mode con Azure…'));
    $('llmClear').addEventListener('click', () => perform(() => BLKLLM.clear(), 'Eliminando credenciales…'));
    BLK.subscribe(() => { $('llmApiKey').value = ''; refresh(); });
    window.addEventListener('focus', refresh);
    refresh();
  }).catch(BLK.showError);
})();
