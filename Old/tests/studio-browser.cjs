const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const artifactDir = process.env.BLK_STUDIO_ARTIFACTS;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  fs.readFile(file, (error, content) => {
    response.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(error ? 'Not found' : content);
  });
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('blkunit:studio:v1:') && key.endsWith(':new')))));
    const frame = () => page.frameLocator('#previewFrame');
    const ready = () => page.waitForFunction(() => !document.getElementById('promptInput').disabled);
    async function generate(text, count) {
      await page.locator('#promptInput').fill(text);
      await page.locator('#promptInput').press('Enter');
      await page.waitForFunction(expected => document.getElementById('versionSelect').options.length === expected && !document.getElementById('promptInput').disabled, count);
      await frame().locator('h1').waitFor({ state: 'attached' });
    }
    async function screenshot(name) {
      if (artifactDir) { fs.mkdirSync(artifactDir, { recursive: true }); await page.screenshot({ path: path.join(artifactDir, name), fullPage: true }); }
    }
    await page.goto(base + '/create-app.html'); await ready();
    assert.equal(await page.locator('.wizard-card').count(), 0);
    assert.equal(await page.locator('.starter-card').count(), 3);
    assert.equal(await page.locator('#reviewButton').isDisabled(), true);
    await screenshot('studio-desktop-empty.png');

    await page.locator('.starter-card').first().click();
    await page.locator('#generationOverlay').waitFor({ state: 'visible' });
    await page.locator('#codeTab').click();
    await page.waitForFunction(() => document.getElementById('codeContent').textContent.includes('<!DOCTYPE'));
    await ready(); await frame().locator('h1').waitFor({ state: 'attached' });
    assert.equal((await draft()).versions.length, 1);
    const original = (await draft()).versions[0].html;
    await page.locator('#previewTab').click();
    assert.equal(await frame().locator('body').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('#previewFrame').getAttribute('sandbox'), 'allow-scripts');
    const generatedFrame = page.frames().find(item => item !== page.mainFrame());
    assert.equal(await generatedFrame.evaluate(() => { try { void parent.document.body; return false; } catch { return true; } }), true);
    assert.equal(await generatedFrame.evaluate(async () => { try { await fetch('/data.json'); return false; } catch { return true; } }), true);
    console.log('PASS: generación, visualización progresiva del código y preview aislada');

    await generate('Ponlo en modo oscuro y cambia el color a violeta', 2);
    assert.equal(await frame().locator('body').getAttribute('data-theme'), 'dark');
    assert.equal((await draft()).versions[0].html, original);
    await page.locator('#mobileButton').click();
    const width = await page.locator('#previewFrame').evaluate(node => node.getBoundingClientRect().width);
    assert.ok(width <= 390, `Ancho móvil inesperado: ${width}`);
    await page.locator('#desktopButton').click();
    await screenshot('studio-desktop-generated.png');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#downloadButton').click()]);
    assert.equal(download.suggestedFilename(), 'index.html');
    assert.match(fs.readFileSync(await download.path(), 'utf8'), /<!DOCTYPE html>/i);
    await page.reload(); await ready();
    assert.equal((await draft()).versions.length, 2);
    assert.equal(await frame().locator('body').getAttribute('data-theme'), 'dark');
    console.log('PASS: iteración, versión original intacta, móvil, descarga y recarga');

    await page.locator('#promptInput').fill('Añade un gráfico');
    await page.locator('#promptInput').press('Enter');
    await page.locator('#generationOverlay').waitFor({ state: 'visible' });
    await page.locator('#stopButton').click(); await ready();
    assert.equal((await draft()).versions.length, 2);
    assert.equal(await frame().locator('body').getAttribute('data-theme'), 'dark');
    assert.match(await page.locator('#chatLog').textContent(), /Generación detenida/);
    await page.locator('#versionSelect').selectOption('1');
    await generate('Cambia el color a azul', 3);
    assert.equal(await frame().locator('body').getAttribute('data-theme'), 'light');
    assert.equal((await draft()).versions[2].spec.dark, false);
    console.log('PASS: cancelación y ramificación desde una versión anterior');

    await page.evaluate(() => BLK.setRole('admin'));
    await page.locator('#reviewButton').click();
    await page.locator('#reviewForm button[type="submit"]').click();
    assert.equal(await page.locator('#reviewError').isVisible(), true);
    await page.evaluate(() => BLK.setRole('developer'));
    await page.locator('#reviewForm button[type="submit"]').click();
    await page.locator('#reviewSuccess').waitFor({ state: 'visible' });
    const submitted = await page.evaluate(() => BLK.apps({ includeUnpublished: true }).at(-1));
    assert.equal(submitted.reviewStatus, 'pending_review');
    assert.equal(submitted.generatedHtml, (await draft()).versions[2].html);
    assert.equal(submitted.attachments.at(-1).name, 'index.html');
    assert.equal(await page.locator('#reviewButton').isDisabled(), true);
    await page.locator('#closeReviewButton').click();
    await page.evaluate(id => { BLK.setRole('admin'); BLK.reviewApp(id, 'changes_requested', 'Cambiar el tema a oscuro', '', 1); BLK.setRole('developer'); }, submitted.id);
    await page.goto(base + '/create-app.html?edit=' + encodeURIComponent(submitted.id)); await ready();
    assert.equal(await frame().locator('body').getAttribute('data-theme'), 'light');
    await generate('Ponlo en modo oscuro', 2);
    await page.locator('#reviewButton').click();
    await page.locator('#reviewForm button[type="submit"]').click();
    await page.locator('#reviewSuccess').waitFor({ state: 'visible' });
    const revised = await page.evaluate(id => BLK.apps({ includeUnpublished: true }).find(item => item.id === id), submitted.id);
    assert.equal(revised.version, 2); assert.equal(revised.ticket, submitted.ticket);
    assert.match(revised.generatedHtml, /data-theme="dark"/);
    await page.locator('#closeReviewButton').click();
    console.log('PASS: permisos de demo, envío con HTML y reenvío con ticket estable');

    const fullAttachmentApp = await page.evaluate(html => {
      const app = BLK.createSubmission({ title: 'Proyecto con adjuntos', desc: 'Dashboard de proyectos con datos ficticios para revisión del equipo.', area: 'it', generatedHtml: html, attachments: Array.from({ length: BLK.config.upload.maxFiles }, (_, index) => ({ name: `fixture-${index}.txt`, type: 'text/plain', size: 20 })) });
      BLK.setRole('admin'); BLK.reviewApp(app.id, 'changes_requested', 'Actualizar el proyecto', '', 1); BLK.setRole('developer');
      return app;
    }, revised.generatedHtml);
    await page.goto(base + '/create-app.html?edit=' + encodeURIComponent(fullAttachmentApp.id)); await ready();
    await page.locator('#reviewButton').click();
    await page.locator('#reviewForm button[type="submit"]').click();
    await page.locator('#reviewSuccess').waitFor({ state: 'visible' });
    const fullAttachmentRevision = await page.evaluate(id => BLK.apps({ includeUnpublished: true }).find(app => app.id === id), fullAttachmentApp.id);
    assert.deepEqual(fullAttachmentRevision.attachments, fullAttachmentApp.attachments);
    assert.equal(fullAttachmentRevision.generatedHtml, revised.generatedHtml);
    await page.locator('#closeReviewButton').click();
    console.log('PASS: reenvío conserva el HTML y todos los adjuntos cuando se alcanza el límite');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('button[data-mobile-view="preview"]').click();
    assert.equal(await page.locator('.workspace').isVisible(), true);
    assert.equal(await page.locator('.chat-panel').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot('studio-mobile-preview.png');
    await page.locator('button[data-mobile-view="chat"]').click();
    await screenshot('studio-mobile-chat.png');
    await page.locator('#newProjectButton').click(); await page.locator('#confirmNewButton').click();
    assert.equal(await page.locator('#reviewButton').isDisabled(), true);
    assert.equal(await page.evaluate(id => BLK.apps({ includeUnpublished: true }).some(app => app.id === id), submitted.id), true);
    await generate('Crea una calculadora de ROI y ahorro de horas del equipo', 1);
    await page.locator('button[data-mobile-view="preview"]').click();
    const savings = await frame().locator('#savings').textContent();
    await frame().locator('#hours').fill('40');
    await frame().locator('#rate').fill('100');
    await frame().locator('#team').fill('20');
    assert.notEqual(await frame().locator('#savings').textContent(), savings);
    console.log('PASS: responsive, nuevo proyecto conserva tickets y calculadora funcional');
    assert.deepEqual(errors, [], `Errores de navegador: ${errors.join(', ')}`);
    await context.close();
    console.log('Tektonik hub Studio: recorrido completo verificado.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
