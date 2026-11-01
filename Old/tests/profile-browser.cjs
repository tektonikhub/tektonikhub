const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLocalServer } = require('..\\server\\local.cjs');

(async () => {
  const server = createLocalServer();
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = process.env.BLK_BROWSER_PATH || [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ].find(fs.existsSync);
    browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    await context.route('https://fonts.gstatic.com/**', route => route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function openProfile(query = '') {
      await page.goto(`${base}/profile.html${query}`);
      await page.waitForFunction(() => typeof window.openToolModal === 'function');
      assert.equal(await page.locator('#blk-data-error').count(), 0);
    }
    async function checkProfile() {
      assert.equal(await page.locator('.creator-tags, .tag-pill, .asset-chip, .tt-code, .tt-compliance, .tool-metrics-pill, #panel-assets, #panel-audit, .tab-btn, [data-i18n="auditBtn"], [data-i18n="tabAssets"], [data-i18n="tabAudit"]').count(), 0);
      assert.deepEqual(await page.locator('.creator-stats-bar .stat-label').evaluateAll(labels => labels.map(label => label.dataset.i18n)), ['statTools']);
      assert.equal(await page.locator('#my-submissions, #my-submissions-title, [data-i18n="mySubmissions"], .btn-card-icon, .creator-cover .cover-tag').count(), 0);
      assert.equal(await page.locator('main').innerText().then(text => /OKTA SSO|DLP COMPLIANT|SOC2 AUDITED/.test(text)), false);
      assert.equal(await page.locator('#panel-tools .tool-category').allTextContents().then(labels => labels.some(label => /APPROVED/i.test(label))), false);
      const count = await page.locator('#panel-tools .tool-card').count();
      const accessLabel = await page.locator('html').getAttribute('lang') === 'en' ? 'Access' : 'Acceder';
      assert.deepEqual(await page.locator('#panel-tools .btn-card-action').allTextContents().then(labels => labels.map(label => label.trim())), Array(count).fill(accessLabel));
      assert.equal(await page.locator('#panel-tools .tool-category span').count(), count);
      assert.equal(await page.locator('#panel-tools .tool-actions-row button').count(), count);
      const fullWidthActions = await page.locator('#panel-tools .tool-actions-row').evaluateAll(rows => rows.every(row => Math.abs(row.getBoundingClientRect().width - row.querySelector('button').getBoundingClientRect().width) < 1));
      assert.equal(fullWidthActions, true, 'Acceder debe ocupar todo el ancho de la fila');
      assert.equal(await page.locator('.creator-stats-bar .stat-num').innerText(), String(count));
      assert.equal(await page.locator('#my-tools-count').innerText(), String(count));
      const layout = await page.evaluate(() => {
        const cover = document.querySelector('.creator-cover').getBoundingClientRect();
        const title = document.querySelector('.creator-title-area h1').getBoundingClientRect();
        const card = document.querySelector('.creator-card').getBoundingClientRect();
        const heading = document.querySelector('.tools-heading').getBoundingClientRect();
        const link = document.querySelector('.tools-heading a').getBoundingClientRect();
        return { gap: title.top - cover.bottom, titleRight: title.right, cardRight: card.right, headingRight: heading.right, linkRight: link.right };
      });
      assert.ok(layout.gap >= 14, 'El nombre debe quedar debajo del fondo negro');
      assert.ok(layout.titleRight <= layout.cardRight, 'El nombre debe caber en el perfil');
      assert.ok(layout.linkRight <= layout.headingRight + 1, 'El enlace de creación debe caber en móvil');
      assert.equal(await page.locator('.tools-heading a').getAttribute('href'), 'create-app.html');
    }
    await openProfile();
    const author = await page.evaluate(() => BLK.catalogApps()[0]?.authorId);
    assert.ok(author, 'Se necesita una herramienta publicada para verificar el modal');
    await openProfile('?user=' + encodeURIComponent(author));
    assert.ok(await page.locator('#panel-tools .tool-card').count() > 0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await checkProfile();
      assert.equal(await page.locator('[data-i18n="tabTools"]').innerText(), 'Mis herramientas');
      assert.equal(await page.locator('.tools-heading a').innerText(), 'Crear herramienta');
      if (process.env.BLK_PROFILE_SCREENSHOT_DIR) {
        await page.locator('.creator-card').screenshot({ path: path.join(process.env.BLK_PROFILE_SCREENSHOT_DIR, `profile-${width}.png`) });
        await page.locator('.tools-heading').screenshot({ path: path.join(process.env.BLK_PROFILE_SCREENSHOT_DIR, `profile-tools-${width}.png`) });
        await page.locator('#panel-tools .tool-card').first().screenshot({ path: path.join(process.env.BLK_PROFILE_SCREENSHOT_DIR, `profile-card-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#panel-tools .btn-card-action').first().click();
    assert.equal(await page.locator('#tool-modal').isVisible(), true);
    assert.equal(await page.locator('#m-title').innerText(), await page.locator('#panel-tools .tool-title').first().innerText());
    await page.locator('.modal-close').click();
    await page.locator('[data-set-lang="en"]').click();
    await checkProfile();
    assert.equal(await page.locator('[data-i18n="tabTools"]').innerText(), 'My tools');
    assert.equal(await page.locator('.tools-heading a').innerText(), 'Create tool');
    await page.evaluate(() => BLK.setRole('developer'));
    await checkProfile();
    await page.reload();
    await page.waitForFunction(() => typeof window.openToolModal === 'function');
    await checkProfile();
    assert.equal(await page.locator('[data-i18n="tabTools"]').innerText(), 'My tools');
    await page.locator('.tools-heading a').click();
    await page.waitForURL('**/create-app.html');
    await page.evaluate(() => BLK.ready);
    assert.equal(await page.locator('#promptInput').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Perfil simplificado: título separado a 1440/390/320px, bloques retirados, contadores, modal, idiomas, cambio de rol, persistencia y enlace de creación OK');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
