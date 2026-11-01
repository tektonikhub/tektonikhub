(() => {
  'use strict';
  let session;
  const orgId = () => window.BLK.currentOrg().id;
  async function request(url, options = {}) {
    let response;
    try { response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store' }); }
    catch (error) { if (error.name === 'AbortError') throw error; throw new Error('No se pudo conectar con el servidor local. Inicia npm run dev y abre el puerto 8027.'); }
    if (response.status === 404) throw new Error('La IA necesita el servidor Node local: inicia npm run dev y abre http://127.0.0.1:8027.');
    let result;
    try { result = await response.json(); } catch { throw new Error('El servidor local no devolvió una respuesta válida.'); }
    if (!response.ok) throw Object.assign(new Error(result.error || 'No se pudo completar la petición.'), { status: response.status });
    return result;
  }
  async function post(url, body, signal, retry = true, id = orgId()) {
    if (!session) session = request('/api/session').catch(error => { session = null; throw error; });
    const { csrf } = await session;
    try { return await request(url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-BLK-CSRF': csrf }, body: JSON.stringify({ ...body, orgId: id }) }); }
    catch (error) { if (retry && error.status === 403) { session = null; return post(url, body, signal, false, id); } throw error; }
  }
  window.BLKLLM = Object.freeze({
    status: () => request('/api/llm/settings?orgId=' + encodeURIComponent(orgId())),
    save: fields => post('/api/llm/settings', fields),
    clear: () => post('/api/llm/clear', {}),
    test: () => post('/api/llm/test', {}),
    generate: (prompt, previous, signal) => post('/api/studio/generate', { prompt, previous }, signal)
  });
})();
