'use strict';

// Integration tests use the rendered UI for every business mutation. Storage is read-only evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = 'C:\\Users\\Claudia\\.copilot\\session-state\\85721884-6c91-4c51-96d2-aba46501f69d\\files\\next-validation';
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const dataKey = 'blkunit:demo:v1';
const sessionKey = 'blkunit:demo-session:v1';
const roleNames = { developer: /^Developer/, catalog: /^Empleado/, admin: /^Administrador/, superadmin: /^Super administrador/ };
const destinations = { developer: '/profile', catalog: '/catalog', admin: '/admin', superadmin: '/super-admin' };
const failures = [];
const passed = [];
const scriptErrors = [];
const externalRequests = [];
let browser, child, base, lastPage, probingOffline = false, serverOutput = '';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(operation, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let error;
  do {
    try { return await operation(); } catch (cause) { error = cause; }
    await sleep(75);
  } while (Date.now() < deadline);
  throw new Error(`${description}: ${error?.message || 'timeout'}`, { cause: error });
}
async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}
async function prepareServer() {
  if (process.env.BLK_NEXT_TEST_URL) {
    const url = new URL(process.env.BLK_NEXT_TEST_URL);
    assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'BLK_NEXT_TEST_URL must be an HTTP(S) server without credentials');
    assert.ok(url.pathname === '/' && !url.search && !url.hash, 'BLK_NEXT_TEST_URL must be a server origin');
    base = url.origin;
    console.log(`Using prepared server ${base}; it will not be stopped.`);
  } else {
    assert.ok(fs.existsSync(path.join(root, '.next', 'BUILD_ID')), 'An existing production build is required. Run npm run build first; this runner never starts next dev or builds.');
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const nextBin = require.resolve('next/dist/bin/next');
    child = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production', BLK_ENABLE_LOCAL_LLM: 'false', NEXT_TELEMETRY_DISABLED: '1' },
    });
    child.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-16000); });
    child.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-16000); });
    child.on('error', error => { serverOutput += `\n${error.message}`; });
    console.log(`Starting existing Next build at ${base} (owned PID ${child.pid}).`);
  }
  await poll(async () => {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Next exited: ${serverOutput}`);
    const response = await fetch(base, { signal: AbortSignal.timeout(2500), redirect: 'manual' });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /citizen developers/i);
  }, 'Production server readiness', 90000);
}
function stopOwnedServer() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0 && child.exitCode === null) console.error(`Could not stop owned PID ${child.pid}: ${result.stderr || result.error || result.stdout}`);
  } else child.kill('SIGTERM');
}
async function screenshot(page, name) {
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true });
}
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', acceptDownloads: true, ...options });
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === base) return route.continue();
    if (!/^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) externalRequests.push(url.origin + url.pathname);
    return route.abort();
  });
  ctx.on('page', page => {
    lastPage = page;
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => scriptErrors.push(`${page.url()}: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      // Disabled LLM 503s and deliberately blocked fonts are network diagnostics, not JS errors.
      if (/^Failed to load resource:/.test(text) && /503|ERR_FAILED/.test(text)) return;
      if (probingOffline && /connect-src|violates.*Content Security Policy/i.test(text)) return;
      scriptErrors.push(`${page.url()}: console.error: ${text}`);
    });
  });
  return ctx;
}
async function closeContext(ctx) {
  const page = ctx.pages().at(-1);
  if (page && !page.isClosed()) await screenshot(page, 'flow-' + (passed.length + failures.length + 1) + '-last-page').catch(() => {});
  await ctx.close();
}
async function session(page) { return page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), sessionKey); }
async function data(page) {
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), dataKey);
  return { ...seed, ...(stored || {}) };
}
async function draft(page, editId = 'new') {
  return page.evaluate(({ sessionKey, editId }) => {
    const identity = JSON.parse(sessionStorage.getItem(sessionKey));
    return JSON.parse(localStorage.getItem(`blkunit:studio:v1:${identity.orgId}:${identity.userId}:${editId}`));
  }, { sessionKey, editId });
}
async function saved(page, predicate, description) {
  return poll(async () => { const value = await data(page); assert.ok(predicate(value), description); return value; }, description);
}
async function login(page, role, orgId = seed.config.defaultOrgId, next = '') {
  await page.goto(`${base}/login?role=${role}${next ? '&next=' + encodeURIComponent(next) : ''}`);
  await page.getByLabel(/^Empresa de demostración/).selectOption(orgId);
  await page.getByRole('button', { name: roleNames[role] }).click();
  await page.waitForURL(base + (next || destinations[role]));
  await page.locator('#main-content h1').first().waitFor();
  assert.equal((await session(page)).role, role);
  assert.equal((await session(page)).orgId, orgId);
}
function dialog(page) { return page.getByRole('dialog'); }
function card(page, title) { return page.locator('article.business-app-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }); }
function row(page, text) { return page.getByRole('row').filter({ hasText: text }); }
async function submitDialog(page, name = 'Guardar') {
  await dialog(page).getByRole('button', { name, exact: true }).click();
  await dialog(page).waitFor({ state: 'hidden' });
}
async function closeDialog(page) {
  await dialog(page).getByRole('button', { name: 'Cerrar diálogo', exact: true }).click();
  await dialog(page).waitFor({ state: 'hidden' });
}
async function confirmDelete(page, target, cancelFirst = true) {
  await target.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await dialog(page).waitFor();
  if (cancelFirst) {
    await dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    await target.waitFor();
    await target.getByRole('button', { name: 'Eliminar', exact: true }).click();
  }
  await submitDialog(page, 'Eliminar');
  await target.waitFor({ state: 'hidden' });
}
async function generate(page, text, versions, editId = 'new') {
  await page.locator('#promptInput').fill(text);
  await page.locator('#promptInput').press('Enter');
  await poll(async () => {
    assert.equal(await page.locator('#promptInput').isEnabled(), true);
    const stored = await draft(page, editId);
    assert.equal(stored?.versions.length, versions);
  }, `Persisting ${versions} Studio versions`);
  await page.frameLocator('#previewFrame').locator('h1').waitFor({ state: 'attached' });
}
async function download(page, button, filename) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button, exact: true }).click()]);
  assert.equal(file.suggestedFilename(), filename);
  assert.equal(await file.failure(), null);
  const stream = await file.createReadStream();
  assert.ok(stream, 'Export download provides a readable stream');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
async function run(name, operation) {
  const before = scriptErrors.length;
  try {
    await operation();
    assert.deepEqual(scriptErrors.slice(before), [], 'No uncaught JavaScript or console errors in this flow');
    passed.push(name);
    console.log('PASS: ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL: ${name}\n${error.stack}`);
    if (scriptErrors.length > before) console.error(JSON.stringify(scriptErrors.slice(before), null, 2));
    if (lastPage && !lastPage.isClosed()) await screenshot(lastPage, 'failure-' + failures.length).catch(() => {});
  }
}

async function landingAndContracts() {
  assert.deepEqual([seed.organizations.length, seed.users.length, seed.apps.length, seed.reviews.length], [6, 21, 16, 13]);
  const response = await fetch(base);
  const html = await response.text();
  assert.match(html, /Empodera a tus citizen developers/);
  assert.match(html, /<title>Tektonik hub/);
  assert.match(html, /property="og:site_name" content="Tektonik hub"/);
  assert.doesNotMatch(html, /\bBLK\s+(?:Unit|Studio)\b|>BLK<|>UNIT</i);
  assert.match(html, /NEXT\.JS \/ REACT \/ TYPESCRIPT \/ TAILWIND/);
  assert.match(html, /16/);
  const archivedFiles = ['index.html', 'login.html', 'app-catalog.html', 'profile.html', 'company-profile.html', 'create-app.html', 'admin.html', 'super-admin.html'];
  for (const file of archivedFiles) {
    for (const prefix of ['', '/legacy', '/Old']) {
      const result = await fetch(`${base}${prefix}/${file}`, { redirect: 'manual' });
      assert.equal(result.status, 404, `${prefix}/${file} must not be served or redirected`);
      assert.equal(result.headers.get('location'), null);
    }
  }
  assert.doesNotMatch(html, /(?:href|src)=["'][^"']*(?:\/legacy\/|\/Old\/|\.html)/i);
  for (const route of ['/login', '/catalog', '/profile', '/company', '/studio', '/admin', '/super-admin']) {
    const result = await fetch(base + route);
    assert.equal(result.status, 200, route);
    assert.doesNotMatch(await result.text(), /(?:href|src)=["'][^"']*(?:\/legacy\/|\/Old\/|\.html)/i);
  }
  // Production must refuse the bridge before processing credentials or talking to Azure.
  for (const [method, endpoint] of [['GET', '/api/session'], ['GET', '/api/llm/settings?orgId=%234029'], ['POST', '/api/llm/settings'], ['POST', '/api/llm/clear'], ['POST', '/api/llm/test'], ['POST', '/api/studio/generate']]) {
    const result = await fetch(base + endpoint, { method, headers: { Origin: base, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(result.status, 503, `${method} ${endpoint} must be disabled in production`);
    const body = await result.json();
    assert.match(body.error, /desactivado|desarrollo/i);
    assert.notEqual(body.ok, true);
    assert.equal(body.configured, undefined);
    assert.match(result.headers.get('cache-control'), /no-store/);
  }
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await page.goto(base);
    await page.getByRole('heading', { name: /Empodera a tus citizen developers/ }).waitFor();
    await screenshot(page, 'landing-desktop');
    await page.getByRole('button', { name: 'ES / EN', exact: true }).click();
    await page.getByRole('heading', { name: /Empower your citizen developers/ }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.reload();
    await page.getByRole('heading', { name: /Empower your citizen developers/ }).waitFor();
    await page.getByRole('button', { name: 'Data and privacy', exact: true }).click();
    assert.match(await dialog(page).textContent(), /sessionStorage/);
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'ES / EN', exact: true }).click();
    await page.getByRole('link', { name: 'Acceder', exact: true }).click();
    await page.getByLabel(/^Empresa de demostración/).waitFor();
  } finally { await closeContext(ctx); }
}

async function guardsAndCatalog() {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    for (const route of ['/catalog', '/profile', '/company', '/studio', '/admin', '/super-admin']) {
      await page.goto(base + route);
      await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('next') === route);
      await page.getByLabel(/^Empresa de demostración/).waitFor();
      assert.equal(await session(page), null);
    }
    await page.goto(`${base}/login?role=catalog&next=${encodeURIComponent('https://example.invalid/steal')}`);
    await page.getByRole('button', { name: roleNames.catalog }).click();
    await page.waitForURL(base + '/catalog');
    for (const route of ['/admin', '/super-admin', '/studio']) {
      await page.goto(base + route);
      await page.getByRole('heading', { name: 'Acceso no disponible', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Nueva aplicación', exact: true }).count(), 0);
      assert.equal(await page.locator('#promptInput').count(), 0);
    }
    await page.goto(base + '/catalog');
    await page.getByRole('heading', { name: 'Catálogo de aplicaciones', exact: true }).waitFor();
    const approved = seed.apps.filter(app => app.orgId === seed.config.defaultOrgId && app.reviewStatus === 'approved');
    assert.equal(await page.locator('article.business-app-card').count(), approved.length);
    await page.keyboard.press('Control+k');
    assert.equal(await page.getByLabel('Buscar herramienta', { exact: true }).evaluate(node => node === document.activeElement), true);
    await page.getByLabel('Buscar herramienta', { exact: true }).fill(approved[0].title);
    await page.getByLabel('Buscar herramienta', { exact: true }).press('Enter');
    await page.waitForURL(url => url.pathname === '/catalog' && url.searchParams.get('q') === approved[0].title);
    await card(page, approved[0].title).waitFor();
    assert.equal(await page.locator('article.business-app-card').count(), 1);
    await page.getByRole('button', { name: 'Lista', exact: true }).click();
    assert.equal(await page.locator('.business-app-list').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Lista', exact: true }).getAttribute('aria-pressed'), 'true');
    await card(page, approved[0].title).getByRole('button', { name: 'Detalles', exact: true }).click();
    assert.match(await dialog(page).textContent(), new RegExp(approved[0].ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await dialog(page).getByRole('button', { name: 'Acceder · demo', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'no se ejecuta ni despliega código' }).waitFor();
    await closeDialog(page);
    await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
    await page.getByRole('button', { name: 'Cuadrícula', exact: true }).click();
    const area = seed.categories.find(category => category.id === approved[0].area);
    await page.getByRole('button', { name: new RegExp('^' + area.label) }).click();
    assert.equal(await page.locator('article.business-app-card').count(), approved.filter(app => app.area === area.id).length);
    await page.getByLabel(/^Madurez del catálogo/).selectOption(approved[0].maturity);
    assert.equal(await page.locator('article.business-app-card').count(), approved.filter(app => app.area === area.id && app.maturity === approved[0].maturity).length);
    if (approved[0].tags.length) {
      await page.getByLabel(/^Tipo de herramienta/).selectOption(approved[0].tags[0]);
      assert.equal(await page.locator('article.business-app-card').count(), approved.filter(app => app.area === area.id && app.maturity === approved[0].maturity && app.tags.includes(approved[0].tags[0])).length);
    }
    await page.getByLabel('Buscar aplicaciones', { exact: true }).fill('no-existe-next-browser');
    await page.getByRole('heading', { name: 'No se encontraron aplicaciones', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Restablecer filtros', exact: true }).click();
    assert.equal(await page.locator('article.business-app-card').count(), approved.length);
    await page.goto(base + '/catalog?app=' + encodeURIComponent(approved[0].id));
    await dialog(page).getByRole('heading', { name: approved[0].title, exact: true }).waitFor();
    await closeDialog(page);
    assert.equal(await dialog(page).count(), 0);
    const tab = await ctx.newPage();
    await tab.goto(base + '/catalog');
    await tab.waitForURL(url => url.pathname === '/login');
    assert.equal(await session(tab), null, 'New independent tab has no inherited demo identity');
    assert.equal((await session(page)).role, 'catalog');
    const tenant = seed.organizations.find(org => ['active', 'active-amber'].includes(org.status) && org.id !== seed.config.defaultOrgId && seed.users.some(user => user.orgId === org.id && user.role === 'admin'));
    assert.ok(tenant, 'Fixture has a second active tenant with an administrator identity');
    await login(tab, 'admin', tenant.id, '/catalog');
    const tenantApps = seed.apps.filter(app => app.orgId === tenant.id && app.reviewStatus === 'approved');
    assert.equal(await tab.locator('article.business-app-card').count(), tenantApps.length);
    await tab.goto(base + '/catalog?app=' + encodeURIComponent(approved[0].id));
    await tab.getByRole('status').filter({ hasText: 'no existe o no está aprobada' }).waitFor();
    assert.equal(await dialog(tab).count(), 0, 'Foreign tenant deep link is not disclosed');
    await page.getByRole('button', { name: 'Cerrar sesión local', exact: true }).click();
    await page.waitForURL(base + '/login');
    assert.equal(await session(page), null);
    assert.equal((await session(tab)).orgId, tenant.id, 'Logout is scoped to the current tab');
  } finally { await closeContext(ctx); }
}

async function studioReviewLifecycle() {
  const ctx = await context();
  try {
    const developer = await ctx.newPage();
    await login(developer, 'developer', seed.config.defaultOrgId, '/studio');
    await developer.locator('#promptInput').waitFor();
    await poll(async () => assert.equal(await developer.locator('#promptInput').isEnabled(), true), 'Studio initialization');
    assert.equal(await developer.getByRole('button', { name: 'Enviar a IT', exact: true }).isDisabled(), true);
    await generate(developer, 'Dashboard de operaciones con filtros y tabla para revisar resultados del equipo', 1);
    const original = (await draft(developer)).versions[0].html;
    assert.equal(await developer.locator('#previewFrame').getAttribute('sandbox'), 'allow-scripts');
    const preview = await developer.locator('#previewFrame').elementHandle();
    const frame = await preview.contentFrame();
    assert.equal(await frame.evaluate(() => { try { void parent.document.body; return false; } catch { return true; } }), true);
    for (const csp of await frame.locator('meta[http-equiv="Content-Security-Policy"]').evaluateAll(nodes => nodes.map(node => node.content))) assert.match(csp, /connect-src 'none'/);
    probingOffline = true;
    try {
      assert.equal(await frame.evaluate(async () => { try { await fetch('/data.json'); return false; } catch { return true; } }), true, 'Preview cannot fetch data');
    } finally { await sleep(100); probingOffline = false; }
    await developer.getByRole('tab', { name: 'Código HTML', exact: true }).click();
    assert.match(await developer.locator('#codePanel code').textContent(), /<!DOCTYPE html>/i);
    await developer.getByRole('tab', { name: 'Preview', exact: true }).click();
    await developer.getByRole('button', { name: 'Tema oscuro', exact: true }).click();
    await poll(async () => assert.equal((await draft(developer))?.versions.length, 2), 'Dark iteration persisted');
    await poll(async () => assert.equal(await developer.locator('#promptInput').isEnabled(), true), 'Iteration complete');
    assert.equal((await draft(developer)).versions[0].html, original, 'Original version is immutable');
    assert.equal((await draft(developer)).versions[1].spec.dark, true);
    assert.equal((await draft(developer)).versions[1].parentId, 1);
    await developer.locator('#versionSelect').selectOption('1');
    await developer.getByRole('button', { name: 'Crear rama', exact: true }).click();
    await poll(async () => assert.equal((await draft(developer)).versions.length, 3), 'Branch persisted');
    assert.equal((await draft(developer)).versions[2].parentId, 1);
    assert.equal((await draft(developer)).versions[2].html, original);
    await developer.locator('#versionSelect').selectOption('2');
    // Cancellation is triggered at the first busy render, not after an arbitrary sleep.
    await developer.locator('#promptInput').fill('Añade gráfico de líneas');
    await developer.locator('#promptInput').press('Enter');
    await developer.locator('.studio-message').getByRole('button', { name: 'Detener generación', exact: true }).click();
    await poll(async () => {
      assert.equal(await developer.locator('#promptInput').isEnabled(), true);
      assert.match((await draft(developer)).messages.at(-1).text, /Generación detenida/);
    }, 'Cancelled generation persisted');
    assert.equal((await draft(developer)).versions.length, 3, 'Cancellation does not add a version');
    assert.equal((await draft(developer)).selectedId, 2);
    assert.equal(await download(developer, 'Exportar HTML', 'index.html'), (await draft(developer)).versions[1].html);
    const exported = JSON.parse(await download(developer, 'Exportar borrador JSON', 'studio-draft.json'));
    assert.equal(exported.versions.length, 3);
    await screenshot(developer, 'studio-desktop-generated');
    await developer.reload();
    await poll(async () => assert.equal(await developer.locator('#promptInput').isEnabled(), true), 'Restored Studio ready');
    assert.equal((await draft(developer)).selectedId, 2);
    assert.equal((await draft(developer)).versions.length, 3);
    await developer.locator('#generationMode').selectOption('azure-openai');
    await developer.locator('#promptInput').fill('Dashboard de prueba sin credenciales');
    await developer.locator('#promptInput').press('Enter');
    await developer.getByRole('alert').filter({ hasText: 'No cambiamos automáticamente al modo demo' }).waitFor();
    assert.equal((await draft(developer)).versions.length, 3, 'Disabled Azure must not report fake generation success');
    await developer.locator('#generationMode').selectOption('demo');
    await generate(developer, 'Tema oscuro', 4);
    await developer.getByLabel('Añadir archivos de referencia', { exact: true }).setInputFiles({ name: 'reference.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic reference metadata only.') });
    await poll(async () => assert.equal((await draft(developer)).files.length, 1), 'Attachment metadata saved');
    const title = 'Next UI Lifecycle';
    await developer.getByRole('button', { name: 'Enviar a IT', exact: true }).click();
    await dialog(developer).getByLabel('Nombre', { exact: true }).fill(title);
    await dialog(developer).getByLabel(/^Descripción/).fill('Prototipo de operaciones con datos ficticios para validar el recorrido completo de revisión.');
    await dialog(developer).getByRole('button', { name: 'Enviar a IT', exact: true }).click();
    await dialog(developer).getByRole('heading', { name: /Enviado a IT ·/ }).waitFor();
    const submitted = (await data(developer)).apps.find(app => app.title === title);
    assert.ok(submitted);
    assert.equal(submitted.reviewStatus, 'pending_review');
    assert.equal(submitted.version, 1);
    assert.equal(submitted.generatedHtml, (await draft(developer)).versions[3].html);
    assert.ok(submitted.attachments.some(file => file.name === 'index.html'));
    assert.ok(submitted.attachments.some(file => file.name === 'reference.txt'));
    await closeDialog(developer);
    assert.equal(await developer.getByRole('button', { name: 'Enviado a IT', exact: true }).isDisabled(), true);
    const admin = await ctx.newPage();
    await login(admin, 'admin');
    assert.equal((await session(developer)).role, 'developer', 'Admin tab does not change developer identity');
    await admin.getByRole('button', { name: /^Cola de revisión/ }).click();
    await card(admin, title).getByRole('button', { name: 'Solicitar cambios', exact: true }).click();
    await dialog(admin).getByLabel(/^Motivo\ obligatorio/).fill('Añadir filtros y conservar el tema oscuro para el equipo de IT.');
    await submitDialog(admin, 'Solicitar cambios');
    await saved(admin, value => value.apps.find(app => app.id === submitted.id)?.reviewStatus === 'changes_requested', 'Changes requested');
    await developer.goto(base + '/profile');
    await developer.getByRole('button', { name: 'Mis envíos', exact: true }).click();
    await card(developer, title).getByText('Añadir filtros y conservar el tema oscuro para el equipo de IT.', { exact: false }).waitFor();
    await card(developer, title).getByRole('link', { name: 'Corregir y reenviar', exact: true }).click();
    await developer.waitForURL(url => url.pathname === '/studio' && url.searchParams.get('edit') === submitted.id);
    await poll(async () => assert.equal(await developer.locator('#promptInput').isEnabled(), true), 'Editing Studio ready');
    await generate(developer, 'Añade filtros y tema oscuro', 2, submitted.id);
    await developer.getByRole('button', { name: 'Enviar a IT', exact: true }).click();
    await dialog(developer).getByLabel('Nombre', { exact: true }).fill(title);
    await dialog(developer).getByRole('button', { name: 'Enviar cambios a IT', exact: true }).click();
    await dialog(developer).getByRole('heading', { name: /Enviado a IT ·/ }).waitFor();
    const revised = (await data(developer)).apps.find(app => app.id === submitted.id);
    assert.equal(revised.ticket, submitted.ticket);
    assert.equal(revised.version, 2);
    assert.equal(revised.reviewStatus, 'pending_review');
    assert.notEqual(revised.generatedHtml, submitted.generatedHtml);
    assert.ok(revised.attachments.some(file => file.name === 'reference.txt'));
    await closeDialog(developer);
    await card(admin, title).getByRole('button', { name: 'Aprobar', exact: true }).click();
    await dialog(admin).getByRole('button', { name: 'Aprobar', exact: true }).click();
    assert.equal((await data(admin)).apps.find(app => app.id === submitted.id).reviewStatus, 'pending_review', 'Missing manual checks block approval');
    await dialog(admin).getByLabel('He realizado la revisión manual de seguridad (demo, no certificación).', { exact: true }).check();
    await dialog(admin).getByRole('button', { name: 'Aprobar', exact: true }).click();
    assert.equal((await data(admin)).apps.find(app => app.id === submitted.id).reviewStatus, 'pending_review', 'Both checks are mandatory');
    await dialog(admin).getByLabel('He revisado manualmente el tratamiento de datos (demo).', { exact: true }).check();
    await dialog(admin).getByLabel('Comentario de revisión', { exact: true }).fill('Versión corregida revisada manualmente en demostración.');
    await submitDialog(admin, 'Aprobar');
    const approvedData = await saved(admin, value => value.apps.find(app => app.id === submitted.id)?.reviewStatus === 'approved', 'Approved resubmission');
    const reviews = approvedData.reviews.filter(review => review.appId === submitted.id);
    assert.deepEqual(reviews.map(review => review.action).sort(), ['approved', 'changes_requested']);
    assert.deepEqual(reviews.find(review => review.action === 'approved').checks, { security: true, data: true });
    await developer.goto(base + '/catalog');
    await developer.getByLabel('Buscar aplicaciones', { exact: true }).fill(title);
    await card(developer, title).waitFor();
    assert.equal(await developer.locator('article.business-app-card').count(), 1);
    await screenshot(developer, 'approved-catalog');
    await developer.reload();
    await card(developer, title).waitFor();
    await admin.goto(base + '/admin');
    await admin.getByLabel('Buscar aplicaciones', { exact: true }).fill(title);
    await card(admin, title).getByRole('button', { name: 'Detalles e historial', exact: true }).click();
    assert.match(await dialog(admin).textContent(), /Versión 2/);
    assert.match(await dialog(admin).textContent(), /Cambios solicitados · v1/);
    assert.match(await dialog(admin).textContent(), /Aprobada · v2/);
    await closeDialog(admin);
    await admin.getByRole('button', { name: 'Restaurar demo', exact: true }).click();
    await dialog(admin).getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.ok((await data(admin)).apps.some(app => app.id === submitted.id));
    await admin.getByRole('button', { name: 'Restaurar demo', exact: true }).click();
    await dialog(admin).getByRole('button', { name: 'Confirmar restauración', exact: true }).click();
    await admin.waitForURL(base + '/login');
    assert.equal(await session(admin), null);
    assert.equal((await data(admin)).apps.length, seed.apps.length);
    assert.equal((await draft(developer, submitted.id)).versions.length, 2, 'Restoring business demo preserves Studio drafts');
  } finally { probingOffline = false; await closeContext(ctx); }
}

async function companyCrud() {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await login(page, 'admin', seed.config.defaultOrgId, '/company');
    await page.getByRole('button', { name: 'Editar empresa', exact: true }).click();
    await dialog(page).getByLabel(/^Descripción\ de\ la\ empresa/).fill('Empresa ficticia personalizada por la prueba de interfaz Next.');
    await dialog(page).getByLabel('Título del banner', { exact: true }).fill('Oficina de IA Next');
    await submitDialog(page);
    await saved(page, value => value.organizations.find(org => org.id === seed.config.defaultOrgId).profile?.bannerTitle === 'Oficina de IA Next', 'Company profile persisted');
    await page.reload();
    await page.getByText('Empresa ficticia personalizada por la prueba de interfaz Next.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Restablecer textos del perfil', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal((await data(page)).organizations.find(org => org.id === seed.config.defaultOrgId).profile.bannerTitle, 'Oficina de IA Next');
    await page.getByRole('button', { name: 'Restablecer textos del perfil', exact: true }).click();
    await submitDialog(page, 'Restablecer');
    assert.equal((await data(page)).organizations.find(org => org.id === seed.config.defaultOrgId).profile, undefined);
    await page.getByRole('button', { name: 'Usuarios de la empresa', exact: true }).click();
    const protectedAdmin = seed.users.find(user => user.orgId === seed.config.defaultOrgId && user.role === 'admin');
    assert.equal(await row(page, protectedAdmin.name).getByRole('button', { name: 'Editar', exact: true }).count(), 0, 'Org admin cannot administer privileged roles');
    await page.getByRole('button', { name: 'Añadir usuario', exact: true }).click();
    assert.deepEqual(await dialog(page).getByLabel(/^Rol de demo/).locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['developer', 'catalog']);
    await dialog(page).getByLabel('Nombre', { exact: true }).fill('Next Company User');
    await dialog(page).getByLabel('Correo ficticio', { exact: true }).fill('next.company@example.invalid');
    await dialog(page).getByLabel('Departamento', { exact: true }).fill('QA demo');
    await submitDialog(page);
    let user = (await data(page)).users.find(user => user.email === 'next.company@example.invalid');
    assert.equal(user.orgId, seed.config.defaultOrgId);
    await row(page, 'Next Company User').getByRole('button', { name: 'Editar', exact: true }).click();
    await dialog(page).getByLabel('Nombre', { exact: true }).fill('Next Company User Edited');
    await dialog(page).getByLabel(/^Rol de demo/).selectOption('catalog');
    await submitDialog(page);
    await page.reload();
    await page.getByRole('button', { name: 'Usuarios de la empresa', exact: true }).click();
    await row(page, 'Next Company User Edited').waitFor();
    user = (await data(page)).users.find(item => item.id === user.id);
    assert.equal(user.role, 'catalog');
    await confirmDelete(page, row(page, 'Next Company User Edited'));
    assert.ok(!(await data(page)).users.some(item => item.id === user.id));
    await page.getByRole('button', { name: 'Administrar aplicaciones', exact: true }).click();
    await page.getByRole('button', { name: 'Nueva aplicación', exact: true }).click();
    await dialog(page).getByLabel('Título', { exact: true }).fill('Next Company App');
    await dialog(page).getByLabel(/^Descripción\ \(mínimo\ 30\ caracteres\)/).fill('Aplicación ficticia creada mediante el formulario de administración de la empresa.');
    await dialog(page).getByLabel(/^Creador/).selectOption(seed.config.demoRoles.developer);
    await dialog(page).getByLabel('Horas ahorradas · estimación demo', { exact: true }).fill('12');
    await submitDialog(page);
    const app = (await data(page)).apps.find(app => app.title === 'Next Company App');
    assert.equal(app.reviewStatus, 'pending_review');
    assert.equal(app.version, 1);
    await card(page, 'Next Company App').getByRole('button', { name: 'Editar', exact: true }).click();
    await dialog(page).getByLabel('Título', { exact: true }).fill('Next Company App Edited');
    await submitDialog(page);
    await saved(page, value => value.apps.find(item => item.id === app.id)?.version === 2, 'Managed edit increments version');
    assert.equal((await data(page)).apps.find(item => item.id === app.id).ticket, app.ticket);
    await card(page, 'Next Company App Edited').getByRole('button', { name: 'Rechazar', exact: true }).click();
    await dialog(page).getByLabel(/^Motivo\ obligatorio/).fill('Rechazo de demostración para validar estado e historial.');
    await submitDialog(page, 'Rechazar');
    assert.equal((await data(page)).apps.find(item => item.id === app.id).reviewStatus, 'rejected');
    await page.reload();
    await page.getByRole('button', { name: 'Administrar aplicaciones', exact: true }).click();
    await card(page, 'Next Company App Edited').waitFor();
    await confirmDelete(page, card(page, 'Next Company App Edited'));
    const after = await data(page);
    assert.ok(!after.apps.some(item => item.id === app.id));
    assert.ok(!after.reviews.some(item => item.appId === app.id));
    assert.ok(!after.events.some(item => item.appId === app.id));
    await page.goto(base + '/admin');
    await page.getByRole('button', { name: 'Políticas de gobernanza', exact: true }).click();
    for (const policy of seed.policies.filter(policy => !policy.orgId)) assert.equal(await card(page, policy.name).getByRole('button', { name: 'Editar', exact: true }).count(), 0, 'Global policies are read-only to org admin');
    await policyCrud(page, false);
    await page.getByRole('button', { name: 'Configuración org · LLM Settings', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Azure está deshabilitado en producción' }).waitFor();
    assert.equal(await page.getByLabel('API key', { exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Probar conexión (consume cuota)', exact: true }).isDisabled(), true);
  } finally { await closeContext(ctx); }
}

async function policyCrud(page, global) {
  const title = global ? 'Next Global Policy' : 'Next Tenant Policy';
  await page.getByRole('button', { name: global ? 'Nueva política global' : 'Nueva política de organización', exact: true }).click();
  await dialog(page).getByLabel('Nombre', { exact: true }).fill(title);
  await dialog(page).getByLabel(/^Descripción/).fill('Política informativa de demostración, sin controles automáticos.');
  await submitDialog(page);
  const created = (await data(page)).policies.find(policy => policy.name === title);
  assert.ok(created);
  assert.equal(created.orgId, global ? undefined : seed.config.defaultOrgId);
  await card(page, title).getByRole('button', { name: 'Editar', exact: true }).click();
  await dialog(page).getByLabel('Nombre', { exact: true }).fill(title + ' Edited');
  await dialog(page).getByLabel('Habilitada (informativa)', { exact: true }).uncheck();
  await submitDialog(page);
  assert.equal((await data(page)).policies.find(policy => policy.id === created.id).enabled, false);
  if (!global) assert.equal((await data(page)).policies.find(policy => policy.id === created.id).version, 2);
  await confirmDelete(page, card(page, title + ' Edited'));
  assert.ok(!(await data(page)).policies.some(policy => policy.id === created.id));
}

async function superAdminCrud() {
  const ctx = await context();
  try {
    const page = await ctx.newPage();
    await login(page, 'superadmin');
    assert.equal((await data(page)).organizations.length, 6, 'Separate browser context starts with seed');
    await page.getByRole('button', { name: 'Planes', exact: true }).click();
    await page.getByRole('button', { name: 'Crear plan', exact: true }).click();
    await dialog(page).getByLabel('Nombre', { exact: true }).fill('Next Plan');
    await dialog(page).getByLabel('Precio mensual (€); vacío = consultar', { exact: true }).fill('19.95');
    await submitDialog(page);
    const plan = (await data(page)).plans.find(plan => plan.name === 'Next Plan');
    assert.equal(plan.price, 19.95);
    await row(page, 'Next Plan').getByRole('button', { name: 'Editar', exact: true }).click();
    await dialog(page).getByLabel('Nombre', { exact: true }).fill('Next Plan Edited');
    await submitDialog(page);
    await page.getByRole('button', { name: 'Organizaciones', exact: true }).click();
    await page.getByRole('button', { name: 'Crear organización', exact: true }).click();
    await dialog(page).getByLabel('Nombre de la organización', { exact: true }).fill('Next Organization');
    await dialog(page).getByLabel('Dominio (opcional)', { exact: true }).fill('next-org.example.invalid');
    await dialog(page).getByLabel('Correo ficticio del administrador', { exact: true }).fill('next.org.admin@example.invalid');
    await dialog(page).getByLabel(/^Plan/).selectOption(plan.id);
    await submitDialog(page, 'Crear organización');
    const organization = (await data(page)).organizations.find(org => org.name === 'Next Organization');
    assert.ok(organization);
    assert.ok((await data(page)).users.some(user => user.id === organization.adminId && user.role === 'admin'));
    await row(page, 'Next Organization').getByRole('button', { name: 'Editar', exact: true }).click();
    await dialog(page).getByLabel('Nombre de la organización', { exact: true }).fill('Next Organization Edited');
    await submitDialog(page, 'Guardar cambios');
    await page.reload();
    await row(page, 'Next Organization Edited').waitFor();
    await row(page, 'Next Organization Edited').getByRole('button', { name: 'Detalles', exact: true }).click();
    assert.match(await dialog(page).textContent(), /next.org.admin@example.invalid/);
    await closeDialog(page);
    await row(page, 'Next Organization Edited').getByRole('button', { name: 'Suspender', exact: true }).click();
    await submitDialog(page, 'Suspender');
    assert.equal((await data(page)).organizations.find(org => org.id === organization.id).status, 'suspended');
    const other = await ctx.newPage();
    await other.goto(base + '/login');
    await other.getByLabel(/^Empresa de demostración/).selectOption(organization.id);
    await other.getByRole('button', { name: roleNames.admin }).click();
    await other.getByRole('alert').filter({ hasText: /activa|suspendida/i }).first().waitFor();
    assert.equal(await session(other), null, 'Suspended organization cannot select an admin identity');
    await row(page, 'Next Organization Edited').getByRole('button', { name: 'Reactivar', exact: true }).click();
    await submitDialog(page, 'Activar');
    await login(other, 'admin', organization.id, '/company');
    await other.getByRole('heading', { name: 'Next Organization Edited', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Planes', exact: true }).click();
    const beforeBlocked = (await data(page)).revision;
    await row(page, 'Next Plan Edited').getByRole('button', { name: 'Eliminar', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Eliminar', exact: true }).click();
    await dialog(page).getByRole('alert').filter({ hasText: /asignado/ }).waitFor();
    assert.equal((await data(page)).revision, beforeBlocked, 'Protected plan removal does not commit');
    await closeDialog(page);
    await page.getByRole('button', { name: 'Usuarios y administradores', exact: true }).click();
    await page.getByRole('button', { name: 'Añadir usuario', exact: true }).click();
    assert.equal(await dialog(page).getByLabel(/^Rol de demo/).locator('option').count(), 4);
    await dialog(page).getByLabel('Nombre', { exact: true }).fill('Next Global User');
    await dialog(page).getByLabel('Correo ficticio', { exact: true }).fill('next.global@example.invalid');
    await dialog(page).getByLabel(/^Rol de demo/).selectOption('admin');
    await dialog(page).getByLabel(/^Organización/).selectOption(organization.id);
    await submitDialog(page);
    const user = (await data(page)).users.find(user => user.email === 'next.global@example.invalid');
    assert.equal(user.role, 'admin');
    assert.equal(user.orgId, organization.id);
    await row(page, 'Next Global User').getByRole('button', { name: 'Editar', exact: true }).click();
    await dialog(page).getByLabel('Nombre', { exact: true }).fill('Next Global User Edited');
    await dialog(page).getByLabel(/^Rol de demo/).selectOption('developer');
    await submitDialog(page);
    assert.equal((await data(page)).users.find(item => item.id === user.id).role, 'developer');
    await confirmDelete(page, row(page, 'Next Global User Edited'));
    const protectedUser = seed.users.find(user => user.id === seed.config.demoRoles.superadmin);
    await row(page, protectedUser.name).getByRole('button', { name: 'Eliminar', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Eliminar', exact: true }).click();
    await dialog(page).getByRole('alert').filter({ hasText: /sesión|demostración/ }).waitFor();
    assert.ok((await data(page)).users.some(item => item.id === protectedUser.id));
    await closeDialog(page);
    await page.getByRole('button', { name: 'Políticas globales', exact: true }).click();
    await policyCrud(page, true);
    const exported = JSON.parse(await download(page, 'Exportar JSON', 'tektonik-hub-data.json'));
    assert.ok(exported.organizations.some(org => org.id === organization.id));
    await page.getByRole('button', { name: 'Organizaciones', exact: true }).click();
    const defaultOrg = seed.organizations.find(org => org.id === seed.config.defaultOrgId);
    await row(page, defaultOrg.name).getByRole('button', { name: 'Eliminar', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Eliminar', exact: true }).click();
    await dialog(page).getByRole('alert').filter({ hasText: /predeterminada|sesión/ }).waitFor();
    assert.ok((await data(page)).organizations.some(org => org.id === defaultOrg.id));
    await closeDialog(page);
    await confirmDelete(page, row(page, 'Next Organization Edited'));
    const remaining = await data(page);
    assert.ok(!remaining.organizations.some(org => org.id === organization.id));
    assert.ok(!remaining.users.some(user => user.orgId === organization.id), 'Organization delete cascades to its demo users');
    await other.goto(base + '/company');
    await other.waitForURL(url => url.pathname === '/login');
    await page.getByRole('button', { name: 'Planes', exact: true }).click();
    await confirmDelete(page, row(page, 'Next Plan Edited'));
    assert.ok(!(await data(page)).plans.some(item => item.id === plan.id));
  } finally { await closeContext(ctx); }
}

async function mobileAndLocalEngines() {
  const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    await login(page, 'developer');
    const navigation = page.locator('#platform-navigation');
    await poll(async () => assert.equal(await navigation.evaluate(node => node.getBoundingClientRect().right <= 1), true), 'Mobile sidebar starts offscreen');
    await page.getByRole('button', { name: 'Abrir navegación', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Abrir navegación', exact: true }).getAttribute('aria-expanded'), 'true');
    await screenshot(page, 'mobile-sidebar');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Abrir navegación', exact: true }).getAttribute('aria-expanded'), 'false');
    await page.getByRole('button', { name: 'Abrir navegación', exact: true }).click();
    await page.getByRole('link', { name: 'Tektonik hub Studio', exact: true }).click();
    await page.waitForURL(base + '/studio');
    assert.equal(await page.getByRole('button', { name: 'Abrir navegación', exact: true }).getAttribute('aria-expanded'), 'false');
    await poll(async () => assert.equal(await page.locator('#promptInput').isEnabled(), true), 'Mobile Studio ready');
    await page.getByLabel(/^Tipo de herramienta/).selectOption('calculator');
    await generate(page, 'Calculadora de ahorro para el equipo', 1);
    await page.getByRole('button', { name: 'Herramienta', exact: true }).click();
    assert.equal(await page.locator('.studio-chat').isVisible(), false);
    assert.equal(await page.locator('.studio-preview').isVisible(), true);
    const frame = page.frameLocator('#previewFrame');
    const before = await frame.locator('#savings').textContent();
    await frame.locator('#hours').fill('20');
    await frame.locator('#rate').fill('100');
    await frame.locator('#team').fill('10');
    await poll(async () => assert.notEqual(await frame.locator('#savings').textContent(), before), 'Calculator updates offline');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile document has no horizontal overflow');
    await screenshot(page, 'studio-mobile-preview');
    await page.getByRole('button', { name: 'Conversación', exact: true }).click();
    await screenshot(page, 'studio-mobile-chat');
    await page.getByRole('button', { name: 'Reiniciar borrador', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal((await draft(page)).versions.length, 1);
    await page.getByRole('button', { name: 'Reiniciar borrador', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Eliminar y reiniciar', exact: true }).click();
    await dialog(page).waitFor({ state: 'hidden' });
    assert.equal(await draft(page), null);
    await page.getByLabel(/^Tipo de herramienta/).selectOption('kanban');
    await generate(page, 'Kanban de tareas del equipo', 1);
    await page.getByRole('button', { name: 'Herramienta', exact: true }).click();
    const engineFailures = [];
    try {
      await frame.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
      assert.equal(await frame.locator('input[name="task"]').evaluate(input => input.validity.valueMissing), true, 'Empty task remains invalid');
      await frame.getByPlaceholder('Escribe una nueva tarea…', { exact: true }).fill('Tarea offline Next');
      await frame.getByRole('button', { name: 'Añadir tarea', exact: true }).click();
      await frame.locator('#todo-list').getByText('Tarea offline Next', { exact: false }).waitFor();
      await frame.getByPlaceholder('Escribe una nueva tarea…', { exact: true }).fill('Tarea con Enter Next');
      await frame.getByPlaceholder('Escribe una nueva tarea…', { exact: true }).press('Enter');
      await frame.locator('#todo-list').getByText('Tarea con Enter Next', { exact: false }).waitFor();
    } catch (error) {
      engineFailures.push(new Error('Offline kanban UI: ' + error.message, { cause: error }));
      await screenshot(page, 'mobile-kanban-failure');
    }
    await page.getByRole('button', { name: 'Conversación', exact: true }).click();
    await page.getByLabel(/^Tipo de herramienta/).selectOption('form');
    await generate(page, 'Formulario de solicitudes del equipo', 2);
    await page.getByRole('button', { name: 'Herramienta', exact: true }).click();
    try {
      await frame.getByRole('button', { name: 'Añadir solicitud local', exact: true }).click();
      assert.equal(await frame.locator('input[name="name"]').evaluate(input => input.validity.valueMissing), true, 'Empty request remains invalid');
      await frame.locator('input[name="name"]').fill('Persona ficticia');
      await frame.locator('input[name="subject"]').fill('Solicitud Next offline');
      assert.equal(await frame.locator('#request-form').evaluate(form => form.checkValidity()), true, 'Offline form has valid required fields');
      await frame.getByRole('button', { name: 'Añadir solicitud local', exact: true }).click();
      await frame.locator('#request-list').getByText('Solicitud Next offline', { exact: false }).waitFor();
      await frame.locator('input[name="name"]').fill('Persona con Enter');
      await frame.locator('input[name="subject"]').fill('Solicitud con Enter Next');
      await frame.locator('input[name="subject"]').press('Enter');
      await frame.locator('#request-list').getByText('Solicitud con Enter Next', { exact: false }).waitFor();
    } catch (error) {
      engineFailures.push(new Error('Offline request form UI: ' + error.message, { cause: error }));
      await screenshot(page, 'mobile-form-failure');
    }
    if (engineFailures.length) throw new AggregateError(engineFailures, engineFailures.map(error => error.message).join('\n'));
  } finally { await closeContext(ctx); }
}

async function main() {
  try {
    await prepareServer();
    browser = await chromium.launch({ headless: true });
    await run('SSR React routes, persistent language, archived URLs unavailable and disabled production LLM contracts', landingAndContracts);
    await run('Anonymous/role guards, catalog filters/views/details/search and tab/tenant isolation', guardsAndCatalog);
    await run('Studio offline generation/iteration/branch/cancel/export/reload → changes → resubmit → two-check approval → catalog', studioReviewLifecycle);
    await run('Company profile/users/apps CRUD, rejection/cascade, org policies and unavailable LLM settings', companyCrud);
    await run('Superadmin organization/users/plans/global-policies CRUD, suspend/reactivate, protected records and export', superAdminCrud);
    await run('Mobile sidebar/Studio layout and interactive calculator/form/kanban engines', mobileAndLocalEngines);
    assert.deepEqual(externalRequests, [], 'No unexpected network requests outside the prepared application origin');
    console.log(`\n${passed.length}/6 integration flows passed. Screenshots: ${artifacts}`);
    if (scriptErrors.length) console.error(JSON.stringify(scriptErrors, null, 2));
    assert.deepEqual(scriptErrors, [], 'No uncaught JavaScript errors or unexpected console.error messages');
    if (failures.length) throw new AggregateError(failures.map(item => item.error), `${failures.length} integration flows failed`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopOwnedServer();
  }
}
process.once('SIGINT', () => { stopOwnedServer(); process.exit(130); });
process.once('SIGTERM', () => { stopOwnedServer(); process.exit(143); });
main().catch(error => { console.error(error.stack); if (serverOutput && failures.length === 0) console.error(serverOutput); process.exitCode = 1; });
