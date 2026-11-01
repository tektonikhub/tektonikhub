const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const coreOnly = process.argv.includes('--core');
const catalogOnly = process.argv.includes('--catalog-only');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); res.end(content);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const errors = [];
  try {
    const executablePath = process.env.BLK_BROWSER_PATH || [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ].find(file => fs.existsSync(file));
    browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    async function open(name) {
      await page.goto(`${base}/${name}`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.BLK.ready);
      await page.waitForTimeout(80);
      assert.equal(await page.locator('#blk-data-error').count(), 0, `Error visible en ${name}`);
      assert.equal(await page.locator('body').textContent().then(value => /blk:text:/.test(value)), false);
      assert.ok((await page.title()).trim());
      assert.equal((await page.title()).includes('blk:text:'), false);
      assert.equal(await page.locator('textarea').evaluateAll(inputs => inputs.some(input => input.value.includes('blk:text:'))), false);
    }
    const files = catalogOnly ? ['app-catalog.html'] : coreOnly ? ['login.html', 'create-app.html', 'admin.html', 'app-catalog.html', 'super-admin.html'] : fs.readdirSync(root).filter(file => file.endsWith('.html'));
    for (const file of files) { await open(file); console.log('Carga HTML:', file); }
    await open('app-catalog.html');
    const cards = page.locator('#apps-container .review-card');
    assert.ok(await cards.count());
    assert.equal(await page.locator('.status-stamp, .btn-icon-copy, .author-avatar').count(), 0);
    assert.ok(await cards.evaluateAll(items => items.every(card => {
      const title = card.querySelector('h3.app-title');
      const author = card.querySelector('.app-author');
      return card.firstElementChild.firstElementChild === title
        && (title.compareDocumentPosition(author) & Node.DOCUMENT_POSITION_FOLLOWING)
        && parseFloat(getComputedStyle(title).fontSize) > parseFloat(getComputedStyle(author).fontSize)
        && card.querySelectorAll('button').length === 2
        && card.querySelector('.btn-approve').textContent.trim() === 'Acceder';
    })));
    await cards.first().locator('.btn-approve').click();
    assert.equal(await page.locator('#modal-overlay').getAttribute('class'), 'modal-overlay');
    assert.match(await page.locator('#toast').innerText(), /no se ejecuta/);
    for (const id of await page.evaluate(() => BLK.catalogApps().map(app => app.id))) {
      await page.evaluate(id => openModal(id), id);
      assert.doesNotMatch(await page.locator('#modal-content').innerText(), /ahorro|empleados|stack tecnol[oó]gico|certifica|\bDLP\b|\bCISO\b|\bSOC\s*2\b|sandbox/i);
      assert.equal(await page.locator('#modal-content .btn-approve').innerText(), 'Acceder');
      assert.equal(await page.locator('#modal-content .status-stamp').count(), 0);
    }
    await page.evaluate(() => closeModal());
    if (catalogOnly) {
      assert.doesNotMatch(await page.locator('body').innerText(), /horas ahorradas|empleados activos|certifica|\bDLP\b|\bCISO\b|\bSOC\s*2\b|leaks/i);
      assert.equal(await page.locator('.main-content > .stats-row > .stat-card').count(), 1);
      assert.equal(await page.locator('#apps-container .meta-row').count(), 0);
      const total = await page.evaluate(() => BLK.catalogApps().length);
      assert.equal(await page.locator('#apps-container .review-card').count(), total);
      await page.locator('#view-list').click();
      assert.equal(await page.locator('#apps-container').getAttribute('class'), 'apps-list');
      await page.locator('[data-area="finanzas"]').click();
      assert.equal(await page.locator('#apps-container .review-card').count(), await page.evaluate(() => BLK.catalogApps().filter(app => app.area === 'finanzas').length));
      await page.locator('[data-area="all"]').click();
      const title = await page.evaluate(() => BLK.catalogApps()[0].title);
      await page.locator('#search-input').fill(title);
      await page.locator('#apps-container .review-card').first().click();
      await page.locator('#modal-content .btn-approve').click();
      assert.ok((await page.locator('#toast').innerText()).includes('no se ejecuta'));
      await page.setViewportSize({ width: 390, height: 844 });
      await open('app-catalog.html');
      assert.deepEqual(errors, []);
      console.log('Catálogo simplificado: fichas, filtros, búsqueda, vista lista y carga móvil OK');
      return;
    }
    await open('create-app.html');
    await page.evaluate(() => { BLK.reset(); BLK.setRole('developer'); });
    const title = 'Demo <svg onload=window.__xss=1>';
    await page.locator('#promptInput').fill('Crea un dashboard de proyectos con datos ficticios');
    await page.locator('#promptInput').press('Enter');
    await page.waitForFunction(() => !document.getElementById('reviewButton').disabled);
    await page.locator('#reviewButton').click();
    await page.locator('#reviewName').fill(title);
    await page.locator('#reviewArea').selectOption('finanzas');
    await page.locator('#reviewDescription').fill('Datos ficticios de prueba para demostrar una aplicación del MVP completamente conectada.');
    await page.locator('#reviewForm button[type="submit"]').click();
    await page.locator('#reviewSuccess').waitFor({ state: 'visible' });
    const created = await page.evaluate(title => BLK.apps({ includeUnpublished: true }).find(app => app.title === title), title);
    assert.ok(created); assert.equal(created.attachments[0].name, 'index.html');
    assert.match(created.generatedHtml, /<!DOCTYPE html>/i);
    await page.evaluate(() => document.getElementById('reviewForm').requestSubmit());
    assert.equal(await page.evaluate(() => BLK.apps({ includeUnpublished: true }).length), 17);
    await page.reload(); await page.evaluate(() => BLK.ready);
    assert.ok(await page.evaluate(id => BLK.apps({ includeUnpublished: true }).some(app => app.id === id), created.id));
    await open('login.html');
    await Promise.all([page.waitForURL('**/admin.html'), page.locator('[onclick="quickLogin(\'admin\')"]').click()]);
    await page.evaluate(() => BLK.ready);
    const card = page.locator(`article[id="${created.id}"]`);
    assert.ok((await card.textContent()).includes(title));
    assert.equal(await page.evaluate(() => window.__xss || 0), 0);
    await card.locator('[data-action="changes"]').click();
    await page.locator('#modal-changes textarea').fill('Añade un aviso explícito de datos sintéticos.');
    await page.locator('[onclick="confirmChanges()"]').click();
    assert.equal(await page.evaluate(id => BLK.apps({ includeUnpublished: true }).find(app => app.id === id).reviewStatus, created.id), 'changes_requested');
    await open('create-app.html'); await page.evaluate(() => BLK.setRole('developer'));
    if (!coreOnly) {
      await open('profile.html');
      assert.ok((await page.locator('body').textContent()).includes('Añade un aviso explícito'));
      assert.equal(await page.locator(`a[href="create-app.html?edit=${created.id}"]`).count(), 1);
    }
    await open(`create-app.html?edit=${created.id}`);
    assert.equal(await page.locator('#projectName').textContent(), title);
    await page.locator('#promptInput').fill('Ponlo en modo oscuro');
    await page.locator('#promptInput').press('Enter');
    await page.waitForFunction(() => document.getElementById('versionSelect').options.length === 2 && !document.getElementById('promptInput').disabled);
    await page.locator('#reviewButton').click();
    await page.locator('#reviewName').fill(title);
    await page.locator('#reviewForm button[type="submit"]').click();
    await page.locator('#reviewSuccess').waitFor({ state: 'visible' });
    const revised = await page.evaluate(id => BLK.apps({ includeUnpublished: true }).find(app => app.id === id), created.id);
    assert.equal(revised.ticket, created.ticket); assert.equal(revised.version, 2);
    await page.evaluate(() => BLK.setRole('admin')); await open('admin.html');
    await page.locator(`article[id="${created.id}"] [data-action="approve"]`).click();
    await page.locator('#chk-dlp').check(); await page.locator('#chk-sec').check();
    await page.locator('[onclick="confirmApprove()"]').click();
    await open('app-catalog.html');
    assert.equal(await page.locator('#stat-total').textContent(), '14');
    const removedCatalogText = /ahorro|horas ahorradas|empleados activos|stack tecnol[oó]gico|certifica|\bDLP\b|\bCISO\b|\bSOC\s*2\b|leaks/i;
    assert.doesNotMatch(await page.locator('body').innerText(), removedCatalogText);
    assert.equal(await page.locator('.main-content > .stats-row > .stat-card').count(), 1);
    assert.equal(await page.locator('#apps-container .meta-row').count(), 0);
    assert.ok((await page.locator('#apps-container').textContent()).includes(title));
    assert.equal(await page.evaluate(() => window.__xss || 0), 0);
    await page.locator('#search-input').fill(title);
    await page.locator('#apps-container .review-card').click();
    assert.ok((await page.locator('#modal-content').textContent()).includes(title));
    assert.doesNotMatch(await page.locator('#modal-content').innerText(), removedCatalogText);
    assert.equal(await page.locator('#modal-content .stat-card').count(), 1);
    await page.locator('#modal-content .btn-approve').click();
    assert.ok((await page.locator('#toast').textContent()).includes('no se ejecuta'));
    console.log('Flujo conectado y contenido seguro: OK');
    const second = await context.newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(`${base}/app-catalog.html`); await second.evaluate(() => BLK.ready);
    await page.evaluate(() => BLK.setRole('developer'));
    const extra = await page.evaluate(() => BLK.createSubmission({ title: 'Cross-tab demo', desc: 'Descripción sintética suficientemente extensa para verificar sincronización entre pestañas.', area: 'it', attachments: [] }));
    await page.evaluate(id => { BLK.setRole('admin'); BLK.reviewApp(id, 'approved', '', 'Demo', 1); }, extra.id);
    await second.waitForFunction(() => document.getElementById('stat-total').textContent === '15');
    await page.evaluate(() => { BLK.saveBrand({ ...BLK.config.brandDefaults, accent: '#123456' }); });
    await second.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent') === '#123456');
    await second.close();
    console.log('Sincronización entre pestañas y marca: OK');
    await page.evaluate(() => BLK.setRole('superadmin')); await open('super-admin.html');
    await page.evaluate(() => openModal('newOrgModal'));
    await page.locator('#newOrgName').fill('Demo <b>empresa</b>');
    await page.locator('#newOrgPlan').selectOption('starter');
    await page.locator('#newOrgEmail').fill('admin@demo.test');
    await page.locator('#newOrgDomain').fill('demo.test');
    await page.locator('[onclick="createOrg()"]').click();
    const org = await page.evaluate(() => BLK.organizations().find(org => org.name === 'Demo <b>empresa</b>'));
    assert.ok(org); assert.ok((await page.locator('#orgsBody').textContent()).includes('Demo <b>empresa</b>'));
    await page.evaluate(id => openOrgDetail(id), org.id); await page.locator('#suspendBtn').click();
    assert.equal(await page.evaluate(id => BLK.organizations().find(org => org.id === id).status, org.id), 'suspended');
    await page.evaluate(id => openReactivate(id), org.id);
    await page.reload(); await page.evaluate(() => BLK.ready);
    assert.equal(await page.evaluate(id => BLK.organizations().find(org => org.id === id).status, org.id), 'active');
    console.log('Gestión local de organizaciones: OK');
    // A failed load must expose recovery rather than leaving an apparently usable screen.
    await page.route('**/data.json', route => route.fulfill({ status: 500, body: 'failed' }));
    await page.goto(`${base}/app-catalog.html`);
    await page.locator('#blk-data-error').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#blk-data-error').textContent()).includes('HTTP 500'));
    await page.unroute('**/data.json'); await open('app-catalog.html');
    await page.evaluate(() => { localStorage.setItem('unrelated-app', 'keep'); BLK.reset(); });
    assert.equal(await page.evaluate(() => BLK.catalogApps().length), 13);
    assert.equal(await page.evaluate(() => localStorage.getItem('unrelated-app')), 'keep');
    assert.deepEqual(errors, [], 'Errores JavaScript en navegador');
    console.log('Recuperación de errores y reset selectivo: OK');
    if (!coreOnly) {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const file of files) { await open(file); }
      assert.deepEqual(errors, [], 'Errores JavaScript en viewport móvil');
      console.log('Carga de ocho pantallas a 390px: OK (no sustituye una auditoría responsive)');
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

