const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, body) => {
    res.writeHead(error ? 404 : 200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(file)] || 'text/plain') + '; charset=utf-8' });
    res.end(error ? '' : body);
  });
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = process.env.BLK_BROWSER_PATH || ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(fs.existsSync);
    browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const url = `http://127.0.0.1:${server.address().port}/company-profile.html`;
    async function checkSimplifiedHeader() {
      assert.deepEqual(await page.locator('.org-stats-bar .stat-label').evaluateAll(labels => labels.map(label => label.dataset.i18n)), ['statApps', 'statUsers']);
      const layout = await page.evaluate(() => {
        const cover = document.querySelector('.org-cover').getBoundingClientRect();
        const title = document.querySelector('.org-title-area h1').getBoundingClientRect();
        const card = document.querySelector('.org-card').getBoundingClientRect();
        const stats = [...document.querySelectorAll('.org-stats-bar .stat-box')].map(box => box.getBoundingClientRect());
        const org = BLK.currentOrg();
        const ids = new Set(BLK.apps({ orgId: org.id, includeUnpublished: true }).map(app => app.id));
        const locale = document.documentElement.lang === 'en' ? 'en-US' : 'es-ES';
        return {
          titleGap: title.top - cover.bottom, titleRight: title.right, cardRight: card.right,
          statsTop: stats.map(box => box.top), statsWidth: stats.map(box => box.width),
          expectedStats: [BLK.catalogApps().filter(app => ids.has(app.id)).length, org.members].map(value => Number(value || 0).toLocaleString(locale))
        };
      });
      assert.ok(layout.titleGap >= 14, 'El título debe quedar separado del fondo negro');
      assert.ok(layout.titleRight <= layout.cardRight, 'El título debe caber en la tarjeta');
      assert.equal(layout.statsTop[0], layout.statsTop[1], 'Los indicadores deben ocupar una fila');
      assert.ok(Math.abs(layout.statsWidth[0] - layout.statsWidth[1]) < 1, 'Los indicadores deben tener el mismo ancho');
      assert.deepEqual(await page.locator('.org-stats-bar .stat-num').allTextContents(), layout.expectedStats);
    }
    await page.goto(url); await page.evaluate(() => BLK.ready);
    await page.waitForFunction(() => typeof window.shareOrganization === 'function');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await checkSimplifiedHeader();
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await page.locator('#company-toolbar').isVisible(), false);
    await page.evaluate(() => BLK.setRole('admin'));
    assert.equal(await page.locator('.apps-grid .app-card').count(), 16);
    await page.locator('[data-company-action="edit-profile"]').click();
    await page.locator('#company-name').fill('Empresa <b>CRUD</b>');
    await page.locator('#company-domain').fill('empresa.test');
    await page.locator('#company-bio').fill('<img src=x onerror=alert(1)> Descripción literal');
    await page.locator('#company-bannerTitle').fill('Innovación CRUD');
    await page.locator('#company-bannerDesc').fill('Banner guardado');
    await page.locator('#company-save').click();
    assert.equal(await page.locator('[data-i18n="orgBio"] img').count(), 0);
    assert.equal(await page.locator('[data-i18n="orgBio"]').innerText(), '<img src=x onerror=alert(1)> Descripción literal');
    await page.locator('[data-company-action="new-user"]').click();
    await page.locator('#company-name').fill('Creadora CRUD');
    await page.locator('#company-email').fill('creadora@empresa.test');
    await page.locator('#company-dept').fill('IT');
    await page.locator('#company-save').click();
    const userId = await page.evaluate(() => BLK.data.users.find(row => row.email === 'creadora@empresa.test').id);
    await page.locator(`button[data-company-action="edit-user"][data-record-id="${userId}"]`).click();
    await page.locator('#company-name').fill('Creadora editada');
    await page.locator('#company-save').click();
    await page.locator('[data-company-action="new-app"]').click();
    await page.locator('#company-title').fill('Aplicación CRUD');
    await page.locator('#company-desc').fill('Descripción de prueba con más de treinta caracteres para la aplicación.');
    await page.locator('#company-authorId').selectOption(userId);
    await page.locator('#company-hours').fill('10');
    await page.locator('#company-users').fill('5');
    await page.locator('#company-repoUrl').fill('https://example.test/app');
    await page.locator('#company-save').click();
    const appId = await page.evaluate(() => BLK.data.apps.find(row => row.title === 'Aplicación CRUD').id);
    await page.locator(`button[data-company-action="delete-user"][data-record-id="${userId}"]`).click();
    assert.match(await page.locator('#toast').innerText(), /aplicaciones/);
    await page.locator(`button[data-company-action="approve-app"][data-record-id="${appId}"]`).click();
    await page.locator(`button[data-company-action="edit-app"][data-record-id="${appId}"]`).click();
    await page.locator('#company-title').fill('Aplicación editada');
    await page.locator('#company-hours').fill('15');
    await page.locator('#company-save').click();
    assert.equal(await page.evaluate(id => BLK.data.apps.find(row => row.id === id).reviewStatus, appId), 'pending_review');
    await page.locator('#company-search').fill('Aplicación editada');
    assert.equal(await page.locator('.apps-grid .app-card').count(), 1);
    await page.locator('#company-status').selectOption('approved');
    assert.equal(await page.locator('.apps-grid .app-card').count(), 0);
    await page.locator('#company-status').selectOption('pending_review');
    assert.equal(await page.locator('.apps-grid .app-card').count(), 1);
    await page.locator('#company-search').fill('');
    await page.locator('#company-status').selectOption('');
    await page.reload(); await page.evaluate(() => BLK.ready);
    await page.waitForFunction(() => typeof window.shareOrganization === 'function');
    assert.equal(await page.locator('[data-i18n="itBannerTitle"]').innerText(), 'Innovación CRUD');
    assert.equal(await page.evaluate(id => BLK.data.apps.find(row => row.id === id).metrics.hours, appId), 15);
    await page.locator('[data-set-lang="en"]').click();
    await checkSimplifiedHeader();
    assert.equal(await page.locator('[data-company-action="new-app"]').innerText(), 'Add application');
    assert.equal(await page.locator('[data-i18n="orgBio"]').innerText(), '<img src=x onerror=alert(1)> Descripción literal');
    await page.locator('[data-set-lang="es"]').click();
    const second = await context.newPage(); await second.goto(url); await second.evaluate(() => BLK.ready);
    await page.locator(`button[data-company-action="approve-app"][data-record-id="${appId}"]`).click();
    await second.waitForFunction(id => BLK.catalogApps().some(row => row.id === id), appId);
    await page.evaluate(() => BLK.setRole('catalog'));
    assert.equal(await page.locator('#company-toolbar').isVisible(), false);
    assert.equal(await page.locator('.apps-grid .app-card').count(), 14);
    await page.evaluate(() => BLK.setRole('admin'));
    await page.locator(`button[data-company-action="delete-app"][data-record-id="${appId}"]`).click();
    await second.waitForFunction(id => !BLK.data.apps.some(row => row.id === id), appId);
    await page.locator(`button[data-company-action="delete-user"][data-record-id="${userId}"]`).click();
    await page.locator('[data-company-action="delete-profile"]').click();
    assert.equal(await page.evaluate(() => BLK.currentOrg().profile), undefined);
    assert.equal(await page.evaluate(() => BLK.currentOrg().name), 'Empresa <b>CRUD</b>');
    await second.close();
    await page.locator('button[data-company-action="edit-app"][data-record-id="invoice-matcher"]').click();
    await page.locator('#company-desc').fill('Descripción actualizada del catálogo desde el CRUD del perfil de empresa.');
    await page.locator('#company-save').click();
    await page.locator('button[data-company-action="approve-app"][data-record-id="invoice-matcher"]').click();
    const catalog = await context.newPage();
    await catalog.goto(url.replace('company-profile.html', 'app-catalog.html?app=invoice-matcher'));
    await catalog.evaluate(() => BLK.ready);
    await catalog.waitForSelector('.modal-desc');
    assert.equal(await catalog.locator('.modal-desc').innerText(), 'Descripción actualizada del catálogo desde el CRUD del perfil de empresa.');
    await catalog.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await checkSimplifiedHeader();
    await page.locator('[data-company-action="new-user"]').click();
    assert.equal(await page.locator('#company-dialog').isVisible(), true);
    await page.locator('#company-cancel').click();
    assert.deepEqual(errors, []);
    console.log('Company profile CRUD: perfil, usuarios, apps, revisión, filtros, texto literal, idiomas, persistencia, sincronización y móvil OK');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
