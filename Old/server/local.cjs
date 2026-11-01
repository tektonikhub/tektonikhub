'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const MAX_BODY = 250000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function orgId(value) {
  if (typeof value !== 'string' || !/^[\w#-]{1,80}$/.test(value)) throw failure('Organización inválida.');
  return value;
}
function normalizeSettings(input, previous) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Configuración inválida.');
  let endpoint;
  try { endpoint = new URL(input.endpoint); } catch { throw failure('Introduce el endpoint HTTPS del recurso Azure OpenAI.'); }
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]{0,62}\.openai\.azure\.com$/.test(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw failure('Usa únicamente https://TU-RECURSO.openai.azure.com, sin rutas ni parámetros.');
  if (typeof input.deployment !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(input.deployment)) throw failure('Deployment de Azure inválido. No es el nombre genérico del modelo.');
  const apiVersion = input.apiVersion || '2024-10-21';
  if (typeof apiVersion !== 'string' || !/^20\d{2}-\d{2}-\d{2}(?:-preview)?$/.test(apiVersion)) throw failure('Versión de API inválida.');
  const apiKey = input.apiKey || previous?.apiKey;
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw failure('Introduce una API key válida.');
  return { endpoint: endpoint.origin, deployment: input.deployment, apiVersion, apiKey };
}
function publicSettings(settings) {
  return { available: true, configured: !!settings, endpoint: settings?.endpoint || '', deployment: settings?.deployment || '', apiVersion: settings?.apiVersion || '2024-10-21', storage: 'server-memory' };
}
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw failure('Se requiere application/json.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw failure('Solicitud demasiado grande.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw failure('JSON inválido.'); }
}
async function limitedText(response) {
  if (!response.body?.getReader) {
    const text = await response.text(); if (text.length > MAX_BODY) throw failure('Respuesta de Azure demasiado grande.', 502); return text;
  }
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BODY) throw failure('Respuesta de Azure demasiado grande.', 502); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
function createLocalServer({ azureFetch = globalThis.fetch, root = ROOT } = {}) {
  const settings = new Map(); const active = new Set(); const calls = new Map();
  const csrf = crypto.randomBytes(32).toString('hex');
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const port = server.address()?.port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    try {
      if (!hosts.includes(req.headers.host)) throw failure('Host local no permitido.', 403);
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin) throw failure('Origen no permitido.', 403);
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/session') { json(res, 200, { csrf, localOnly: true }); return; }
        if (req.method === 'GET' && url.pathname === '/api/llm/settings') { json(res, 200, publicSettings(settings.get(orgId(url.searchParams.get('orgId'))))); return; }
        if (req.method !== 'POST') throw failure('Ruta o método no disponibles.', 404);
        if (req.headers.origin !== origin || typeof req.headers['x-blk-csrf'] !== 'string' || !/^[a-f0-9]{64}$/.test(req.headers['x-blk-csrf']) || !crypto.timingSafeEqual(Buffer.from(req.headers['x-blk-csrf']), Buffer.from(csrf))) throw failure('Recarga la página antes de continuar.', 403);
        const body = await readJSON(req);
        const id = orgId(body?.orgId);
        if (url.pathname === '/api/llm/settings') {
          if (active.has(id)) throw failure('Espera a que termine la petición de esta organización.', 409);
          const next = normalizeSettings(body, settings.get(id));
          if (!settings.has(id) && settings.size >= 50) throw failure('Límite de organizaciones locales alcanzado.', 429);
          settings.set(id, next); json(res, 200, publicSettings(next)); return;
        }
        if (url.pathname === '/api/llm/clear') {
          if (active.has(id)) throw failure('Espera a que termine la petición de esta organización.', 409);
          settings.delete(id); calls.delete(id); json(res, 200, publicSettings(null)); return;
        }
        if (!['/api/llm/test', '/api/studio/generate'].includes(url.pathname)) throw failure('Ruta no disponible.', 404);
        const config = settings.get(id);
        if (!config) throw failure('Configura Azure OpenAI en Admin → LLM Settings.', 409);
        if (active.has(id) || active.size >= 2) throw failure('Ya hay una petición en curso. Inténtalo después.', 429);
        const recent = (calls.get(id) || []).filter(time => Date.now() - time < 60000);
        if (recent.length >= 12) throw failure('Límite local: 12 peticiones por minuto y organización.', 429);
        recent.push(Date.now()); calls.set(id, recent); active.add(id);
        const abort = new AbortController();
        const disconnect = () => { if (!res.writableEnded) abort.abort(); };
        res.on('close', disconnect);
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]);
        try {
          const isTest = url.pathname === '/api/llm/test';
          let kit, previous, messages;
          if (isTest) messages = [{ role: 'system', content: 'Return only JSON.' }, { role: 'user', content: 'Return {"ok":true}.' }];
          else {
            if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 2000) throw failure('Describe el dashboard en un máximo de 2000 caracteres.');
            kit = require(path.join(root, 'assets', 'js', 'dashboard-kit.js'));
            try { previous = body.previous ? kit.validate(body.previous) : null; }
            catch { throw failure('La configuración previa del dashboard no es válida.'); }
            const skill = await fs.readFile(path.join(root, '.agents', 'skills', 'dashboard-builder', 'SKILL.md'), 'utf8');
            messages = [
              { role: 'system', content: `You compose Tektonik hub dashboards. Return ONLY one JSON dashboard configuration conforming to the provided schema. Never return HTML, JavaScript, executable expressions, URLs, credentials or extra keys. Data must be synthetic, with at most 100 rows and 12 components. Interpret the user's intent, reuse the prior dashboard when iterating, preserve unchanged data and components. Use only supported components; never claim external integrations or real data.\n${skill.slice(0, 16000)}\n${JSON.stringify(kit.context(body.prompt, previous))}` },
              { role: 'user', content: JSON.stringify({ request: body.prompt, previous }) }
            ];
          }
          const azureURL = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`;
          const response = await azureFetch(azureURL, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'api-key': config.apiKey }, body: JSON.stringify({ messages, response_format: { type: 'json_object' }, max_tokens: isTest ? 64 : 6000 }) });
          if (!response.ok) {
            await response.body?.cancel?.().catch(() => {});
            if ([401, 403].includes(response.status)) throw failure('Azure rechazó las credenciales o los permisos del recurso.', 502);
            if (response.status === 429) throw failure('Azure ha alcanzado su cuota. Inténtalo más tarde.', 429);
            throw failure(`Azure rechazó la solicitud (HTTP ${response.status}). Revisa endpoint, deployment, API y compatibilidad con JSON mode/max_tokens.`, 502);
          }
          let answer;
          try { answer = JSON.parse(await limitedText(response)); } catch (error) { if (error.status) throw error; throw failure('Azure no devolvió una respuesta JSON válida.', 502); }
          const choice = answer.choices?.[0];
          if (!choice || !['stop', undefined].includes(choice.finish_reason)) throw failure('Azure truncó o filtró la respuesta. No se ha creado ninguna versión.', 422);
          let output;
          try { output = JSON.parse(choice.message?.content); } catch { throw failure('El modelo no devolvió configuración JSON válida. Prueba otra petición.', 422); }
          if (isTest) { if (output?.ok !== true) throw failure('El deployment respondió, pero no completó la prueba JSON.', 422); json(res, 200, { ok: true, message: 'Conexión y JSON mode verificados con Azure.' }); }
          else {
            try { output = kit.validate(output); } catch { throw failure('La configuración del modelo no cumple el catálogo de componentes. No se ha creado ninguna versión; prueba una petición más concreta.', 422); }
            json(res, 200, { config: output, provider: 'azure-openai', model: config.deployment });
          }
        } catch (error) {
          if (signal.aborted) throw failure('Petición cancelada o tiempo de espera de Azure agotado.', 504);
          if (error.status) throw error;
          throw failure('No se pudo conectar con Azure. Revisa la conexión y la configuración del recurso.', 502);
        } finally { active.delete(id); res.off('close', disconnect); }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw failure('Método no permitido.', 405);
      const pathname = decodeURIComponent(url.pathname === '/' ? '/create-app.html' : url.pathname);
      const file = path.resolve(root, '.' + pathname);
      const relative = path.relative(root, file);
      const parts = relative.split(path.sep);
      const allowed = (!relative.startsWith('..') && !path.isAbsolute(relative) && !parts.some(part => part.startsWith('.'))) && ((parts.length === 1 && (path.extname(file) === '.html' || relative === 'data.json')) || (parts[0] === 'assets' && !!MIME[path.extname(file)]));
      if (!allowed) throw failure('Archivo no disponible.', 404);
      let content;
      try { content = await fs.readFile(file); } catch { throw failure('Archivo no encontrado.', 404); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!res.destroyed && !res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Error interno del servidor local.' });
    }
  });
  server.on('close', () => { settings.clear(); calls.clear(); });
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8027);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT debe estar entre 1024 y 65535.');
  const server = createLocalServer();
  server.on('error', () => { console.error('No se pudo iniciar el servidor local. Comprueba el puerto.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Tektonik hub Studio: http://127.0.0.1:${port}\nMVP local: sin autenticación real. Las claves permanecen en memoria y se borran al reiniciar. No exponer este servidor a Internet.`));
}
module.exports = { createLocalServer, normalizeSettings };
