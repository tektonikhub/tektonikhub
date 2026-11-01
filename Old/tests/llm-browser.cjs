'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { createLocalServer } = require('../server/local.cjs');
const kit = require('../assets/js/dashboard-kit.js');
const fakeKey = 'browser-test-not-a-real-key';
const requests = [];
let invalid = false, block = false, cancelled = false;
const completion = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
const server = createLocalServer({ azureFetch: async (url, options) => {
  requests.push({ url, options });
  if (block) return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => { cancelled = true; reject(new DOMException('cancelled', 'AbortError')); }, { once: true }); });
  const body = JSON.parse(options.body);
  const input = body.messages.at(-1).content;
  if (input.includes('Return {"ok":true}')) return completion({ ok: true });
  const { request, previous } = JSON.parse(input);
  return completion(invalid ? { script: 'alert(1)' } : kit.createConfig(request, previous));
} });
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.waitForFunction(() => !document.getElementById('promptInput').disabled);
    const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('blkunit:studio:v1:') && key.endsWith(':new')))));
    const frame = () => page.frameLocator('#previewFrame');
    async function generate(prompt, count) {
      await page.locator('#promptInput').fill(prompt); await page.locator('#promptInput').press('Enter');
      await page.waitForFunction(expected => document.getElementById('versionSelect').options.length === expected && !document.getElementById('promptInput').disabled, count);
      await frame().locator('h1').waitFor({ state: 'attached' });
    }
    async function noSecrets() {
      const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      assert.ok(!storage.includes(fakeKey));
      assert.ok(!(await page.content()).includes(fakeKey));
    }
    await page.goto(base + '/admin.html?settings=llm');
    await page.waitForFunction(() => !!window.BLK?.currentUser);
    await page.evaluate(async () => { await BLK.ready; BLK.setRole('admin'); });
    await page.waitForFunction(() => !document.getElementById('llmFields').disabled);
    await page.locator('#llmEndpoint').fill('https://test-resource.openai.azure.com');
    await page.locator('#llmDeployment').fill('test-dashboard');
    await page.locator('#llmApiKey').fill(fakeKey);
    await page.locator('#llmForm button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('llmStatus').textContent.includes('guardadas solo en memoria'));
    assert.equal(await page.locator('#llmApiKey').inputValue(), '');
    await noSecrets();
    await page.locator('#llmTest').click();
    await page.waitForFunction(() => document.getElementById('llmStatus').textContent.includes('verificados con Azure'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.headers['api-key'], fakeKey);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('llmTest').disabled);
    assert.equal(await page.locator('#llmApiKey').inputValue(), '');
    await noSecrets();
    if (process.env.BLK_LLM_ARTIFACTS) {
      fs.mkdirSync(process.env.BLK_LLM_ARTIFACTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.BLK_LLM_ARTIFACTS, 'llm-settings-desktop.png') });
    }
    console.log('PASS: Admin settings, server-only key, mocked Azure test and reload');

    await page.evaluate(() => BLK.setRole('developer'));
    await page.goto(base + '/create-app.html'); await ready();
    await page.waitForFunction(() => !document.getElementById('azureModeOption').disabled);
    await page.locator('#generationMode').selectOption('azure');
    await generate('Crea un dashboard de ventas con KPIs, gráfico, tabla y filtros', 1);
    let saved = await draft();
    assert.equal(saved.versions[0].provider, 'azure-openai');
    assert.equal(saved.versions[0].spec.dashboard.template, 'sales');
    const initial = saved.versions[0];
    assert.ok(await frame().locator('[data-component-id]').count() >= 4);
    const dashboardTable = frame().locator('#dashboard-table');
    const initialText = await dashboardTable.textContent();
    const search = frame().locator('input[data-filter]:not([type="date"])').first();
    assert.ok(await search.count(), 'Dashboard exposes a text search filter');
    await search.fill('zz-no-match-zz');
    assert.notEqual(await dashboardTable.textContent(), initialText);
    await search.fill('');
    assert.equal(await dashboardTable.textContent(), initialText);
    assert.equal(await page.locator('#previewFrame').getAttribute('sandbox'), 'allow-scripts');
    const generatedFrame = page.frames().find(item => item !== page.mainFrame());
    assert.equal(await generatedFrame.evaluate(async () => { try { await fetch('/api/session'); return false; } catch { return true; } }), true);
    assert.equal(await generatedFrame.evaluate(() => { try { void parent.document.body; return false; } catch { return true; } }), true);
    await noSecrets();
    console.log('PASS: actual proxy flow with mocked Azure, validated dashboard and isolated interactive filters');

    await generate('Ponlo en modo oscuro y usa un gráfico de donut', 2);
    saved = await draft();
    assert.equal(saved.versions[1].spec.dashboard.theme.dark, true);
    assert.deepEqual(saved.versions[1].spec.dashboard.data, initial.spec.dashboard.data);
    assert.equal(saved.versions[0].html, initial.html);
    assert.equal(saved.versions[1].spec.dashboard.components.find(item => item.type === 'chart').chartType, 'donut');
    assert.deepEqual(JSON.parse(JSON.parse(requests.at(-1).options.body).messages.at(-1).content).previous, initial.spec.dashboard);
    if (process.env.BLK_LLM_ARTIFACTS) await page.screenshot({ path: path.join(process.env.BLK_LLM_ARTIFACTS, 'azure-dashboard-desktop.png') });
    const beforeUnsupported = requests.length;
    await page.locator('#promptInput').fill('Crea una calculadora de ROI'); await page.locator('#promptInput').press('Enter');
    await page.waitForFunction(() => document.getElementById('chatLog').textContent.includes('El modo Azure de este MVP crea dashboards'));
    await ready(); assert.equal(requests.length, beforeUnsupported); assert.equal((await draft()).versions.length, 2);
    invalid = true;
    await page.locator('#promptInput').fill('Añade otro KPI'); await page.locator('#promptInput').press('Enter');
    await page.waitForFunction(() => document.getElementById('chatLog').textContent.includes('no cumple el catálogo'));
    await ready(); assert.equal((await draft()).versions.length, 2); invalid = false;
    block = true;
    await page.locator('#promptInput').fill('Añade otro gráfico'); await page.locator('#promptInput').press('Enter');
    await page.waitForFunction(() => document.getElementById('engineStatus').textContent.includes('Esperando respuesta'));
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.locator('#stopButton').click(); await ready();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(cancelled, true); assert.equal((await draft()).versions.length, 2); block = false;
    console.log('PASS: preserving config on iteration, invalid model rejection and upstream cancellation');

    await page.locator('#reviewButton').click(); await page.locator('#reviewForm button[type="submit"]').click();
    await page.locator('#reviewSuccess').waitFor({ state: 'visible' });
    const submitted = await page.evaluate(() => BLK.apps({ includeUnpublished: true }).at(-1));
    assert.ok(submitted.tech.includes('Tektonik hub Studio · Azure OpenAI'));
    assert.match(submitted.dataNote, /Azure OpenAI/);
    assert.ok(!submitted.generatedHtml.includes(fakeKey));
    await page.evaluate(id => { BLK.setRole('admin'); BLK.reviewApp(id, 'changes_requested', 'Cambiar color', '', 1); BLK.setRole('developer'); }, submitted.id);
    await page.goto(base + '/create-app.html?edit=' + encodeURIComponent(submitted.id)); await ready();
    await page.waitForFunction(() => !document.getElementById('azureModeOption').disabled);
    await page.locator('#generationMode').selectOption('azure');
    await generate('Cambia el color a azul', 2);
    assert.deepEqual(JSON.parse(JSON.parse(requests.at(-1).options.body).messages.at(-1).content).previous, saved.versions[1].spec.dashboard);
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('blkunit:studio:v1:') && !key.endsWith(':new')))));
    assert.deepEqual(restored.versions[0].spec.dashboard, saved.versions[1].spec.dashboard);
    assert.equal(restored.versions[0].provider, 'azure-openai');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('button[data-mobile-view="preview"]').click();
    await frame().locator('h1').waitFor();
    if (process.env.BLK_LLM_ARTIFACTS) {
      fs.mkdirSync(process.env.BLK_LLM_ARTIFACTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.BLK_LLM_ARTIFACTS, 'azure-dashboard-mobile.png') });
    }
    await page.evaluate(() => BLK.setRole('admin'));
    await page.goto(base + '/admin.html?settings=llm');
    await page.waitForFunction(() => !document.getElementById('llmClear').disabled);
    await page.locator('#llmClear').click();
    await page.waitForFunction(() => document.getElementById('llmStatus').textContent.includes('Credenciales eliminadas'));
    await page.evaluate(() => BLK.setRole('developer'));
    await page.goto(base + '/create-app.html'); await ready();
    await page.waitForFunction(() => document.getElementById('modeNote').textContent.includes('Configura Azure'));
    assert.equal(await page.locator('#azureModeOption').isDisabled(), true);
    assert.equal(await page.locator('#generationMode').inputValue(), 'demo');
    assert.equal((await draft()).versions.length, 2);
    await noSecrets();
    assert.deepEqual(errors, []);
    console.log('PASS: accurate review provenance, declarative ticket restoration, mobile and credential deletion');
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
