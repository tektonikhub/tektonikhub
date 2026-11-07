'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const kit = require('../lib/studio/runtime/dashboard-kit.js');
const copy = value => JSON.parse(JSON.stringify(value));
const config = () => kit.createConfig('sales');

test('exported dashboards use Tektonik hub branding and preserve their configuration selector', () => {
  const html = kit.renderHTML(config());
  assert.match(html, /class="brand-logo">TH<\/div>/);
  assert.match(html, /Tektonik hub Studio<\/footer>/);
  assert.doesNotMatch(html, /\bBLK\s+(?:Unit|Studio)\b|>BLK</i);
  assert.match(html, /id="blk-dashboard-config"/);
});

for (const name of ['sales', 'operations', 'projects']) test(name + ' supplies a validated independent synthetic template', () => {
  const value = kit.createConfig(name);
  assert.equal(value.template, name);
  assert.equal(value.version, 1);
  assert.equal(value.data.length, 36);
  for (const type of ['metric', 'filters', 'chart', 'table']) assert.ok(value.components.some(c => c.type === type));
  assert.match(value.description, /Synthetic/);
  assert.deepEqual(kit.validate(value), value);
  value.data[0].value = 0;
  assert.notEqual(kit.createConfig(name).data[0].value, 0);
});

test('strict schema rejects unknown/injection properties at every level', () => {
  for (const mutate of [
    c => { c.html = '<script>alert(1)</script>'; },
    c => { c.theme.css = 'url(https://example.com)'; },
    c => { c.data[0].onclick = 'alert(1)'; },
    c => { c.components[0].expression = 'window.location'; },
    c => { c.components[0].url = 'javascript:alert(1)'; },
    c => { c.components[0].content = () => 'not text'; },
    c => { c.components[0].id = 'x\"] <script>'; },
    c => { c.theme.accent = '#FFF; background:url(x)'; },
    c => { c.components[0].type = 'iframe'; },
    c => { Object.defineProperty(c, 'title', { get() { throw Error('executed getter'); }, enumerable: true }); },
    c => { Object.defineProperty(c.data[0], '__proto__', { value: {}, enumerable: true }); }
  ]) {
    const value = config(); mutate(value); assert.throws(() => kit.validate(value));
  }
  assert.equal(kit.schema.additionalProperties, false);
  assert.equal(kit.schema.properties.components.items.additionalProperties, false);
  assert.equal(kit.schema.properties.data.items.additionalProperties, false);
});

test('validates required keys, finite numbers, real dates, enums and bounds', () => {
  for (const mutate of [
    c => { delete c.title; }, c => { delete c.theme.dark; }, c => { delete c.data[0].status; },
    c => { c.version = 2; }, c => { c.template = 'custom'; }, c => { c.theme.dark = 'true'; },
    c => { c.title = 'x'.repeat(101); }, c => { c.description = 'x'.repeat(801); },
    c => { c.data[0].category = 'x'.repeat(101); }, c => { c.data[0].label = 'x'.repeat(161); }, c => { c.data[0].status = 'x'.repeat(41); },
    c => { c.data[0].date = '2026-02-30'; }, c => { c.data[0].date = '2026-13-01'; },
    c => { c.data[0].value = Infinity; }, c => { c.data[0].value = NaN; }, c => { c.data[0].value = '12'; },
    c => { c.components[0].id = c.components[1].id; }, c => { c.components[0].id = 'a'.repeat(41); },
    c => { c.components[0].span = 0; }, c => { c.components[0].span = 13; }, c => { c.components[0].span = 1.5; },
    c => { c.components[0].pageSize = 51; }, c => { c.components[0].pageSize = 0; },
    c => { c.components[0].field = 'revenue'; }, c => { c.components[0].aggregation = 'execute'; },
    c => { c.components[0].groupBy = 'label'; }, c => { c.components[0].chartType = 'pie'; },
    c => { c.components[0].columns = ['date', 'date']; }, c => { c.components[0].fields = ['value']; },
    c => { c.components[0].columns = []; }, c => { c.components[0].content = 'x'.repeat(1001); },
    c => { c.components[0].field = undefined; },
    c => { c.data = Array.from({ length: 201 }, () => c.data[0]); },
    c => { c.components = Array.from({ length: 17 }, (_, i) => ({ id: 'component' + i, type: 'metric', title: 'X' })); },
    c => { c.data = new Array(2); },
    c => { Object.defineProperty(c.data, 0, { get() { throw Error('executed array getter'); } }); }
  ]) { const value = config(); mutate(value); assert.throws(() => kit.validate(value)); }
  const valid = config(); valid.data[0].date = '2024-02-29'; valid.data[0].value = -12.5;
  assert.equal(kit.validate(valid).data[0].value, -12.5);
  assert.throws(() => kit.validate(null));
  assert.throws(() => kit.createConfig('x'.repeat(8001)));
});

test('normalizes optional properties without mutating input and supports empty dashboards', () => {
  const value = config(); value.theme.accent = '#abc';
  value.components = [{ id: 'metric', type: 'metric', title: 'Value' }, { id: 'table', type: 'table', title: 'Rows' }, { id: 'chart', type: 'chart', title: 'Plot' }, { id: 'filters', type: 'filters', title: 'Explore' }, { id: 'text', type: 'text', title: 'Note' }];
  const normalized = kit.validate(value);
  assert.equal(normalized.theme.accent, '#ABC'); assert.equal(normalized.components[0].aggregation, 'sum');
  assert.equal(normalized.components[1].pageSize, 8); assert.equal(normalized.components[2].chartType, 'bar');
  assert.deepEqual(normalized.components[3].fields, ['date', 'category', 'status', 'label']);
  assert.equal(normalized.components[4].content, ''); assert.equal(value.components[0].span, undefined);
  value.data = []; value.components = []; assert.doesNotThrow(() => kit.renderHTML(value));
});

test('followups preserve data and unaffected components; deterministic edits compose', () => {
  const previous = config(), original = copy(previous);
  const themed = kit.createConfig('modo oscuro, accent #123abc; gráficos donut', previous);
  assert.equal(themed.theme.dark, true); assert.equal(themed.theme.accent, '#123ABC');
  assert.ok(themed.components.filter(c => c.type === 'chart').every(c => c.chartType === 'donut'));
  assert.deepEqual(themed.data, previous.data); assert.deepEqual(previous, original);
  const removed = kit.createConfig('remove chart and remove filters and remove table', themed);
  assert.ok(removed.components.every(c => !['chart', 'filters', 'table'].includes(c.type)));
  const added = kit.createConfig('add chart line; add filters; add table; light yellow', removed);
  for (const type of ['chart', 'filters', 'table']) assert.ok(added.components.some(c => c.type === type));
  assert.equal(added.components.find(c => c.type === 'chart').chartType, 'line');
  assert.equal(added.theme.dark, false); assert.equal(added.theme.accent, '#FEFF44');
  assert.deepEqual(kit.createConfig('connect Salesforce and email clients', previous), previous);
  assert.deepEqual(kit.createConfig('projects', previous).data, previous.data);
  const extra = kit.createConfig('add another line chart', previous);
  assert.equal(extra.components.length, previous.components.length + 1);
  assert.deepEqual(extra.components.slice(0, -1), previous.components);
  assert.equal(extra.components.at(-1).groupBy, 'date');
  const many = config(); many.components = Array.from({ length: 16 }, (_, i) => ({ id: 'metric' + i, type: 'metric', title: 'Value' }));
  assert.equal(kit.createConfig('add table', many).components.length, 16);
});

test('context is serializable, relevant and states deterministic limitations', () => {
  const context = kit.context('operaciones');
  assert.deepEqual(Object.keys(context.templates), ['operations']);
  assert.deepEqual(context.schema, kit.schema);
  assert.ok(context.components.filters); assert.ok(context.guidance.some(line => /Unsupported/.test(line)));
  assert.doesNotThrow(() => JSON.stringify(context));
  context.schema.properties.title.maxLength = 1;
  assert.equal(kit.context('sales').schema.properties.title.maxLength, 100);
  assert.equal(kit.context('donut', config()).previousConfig.template, 'sales');
});

test('offline HTML has strict CSP, stable selectors, escaped text and parseable scripts', () => {
  const value = config(), injection = '</script><script>alert("X")</script><img src=x onerror=alert(1)>&\u2028\u2029';
  value.title = injection.slice(0, 100); value.description = injection; value.data[0].label = injection;
  value.components.push({ id: 'note', type: 'text', title: '<em>Note</em>', content: injection });
  const html = kit.renderHTML(value);
  assert.match(html, /^<!DOCTYPE html>/); assert.match(html, /connect-src 'none'/); assert.match(html, /form-action 'none'/); assert.match(html, /default-src 'none'/);
  assert.match(html, /&lt;\/script&gt;/); assert.doesNotMatch(html, /<img|<link|<iframe|\sonclick=/i);
  for (const selector of ['dashboard-filters', 'dashboard-table', 'dashboard-metrics', 'data-component-id="total"']) assert.ok(html.includes(selector));
  assert.ok(html.includes('Barlow')); assert.ok(html.includes('DM Sans')); assert.ok(html.includes('JetBrains Mono'));
  const json = html.match(/<script id="blk-dashboard-config" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(json, /[<>&\u2028\u2029]/); assert.equal(JSON.parse(json).data[0].label, injection);
  assert.deepEqual(kit.validate(JSON.parse(json)), kit.validate(value));
  assert.equal((html.match(/id="blk-dashboard-config"/g) || []).length, 1);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|eval)\b|\.innerHTML\s*=/);
  assert.match(script, /localStorage\.setItem/);
  assert.ok(Buffer.byteLength(html) < 200000);
});

test('maximum supported dataset/component counts remain below document budget', () => {
  const value = config();
  value.data = Array.from({ length: 200 }, (_, i) => ({ date: '2026-01-01', category: 'Category ' + i, label: 'x'.repeat(160), value: i, status: 'Ready' }));
  value.components = Array.from({ length: 16 }, (_, i) => ({ id: 'chart' + i, type: 'chart', title: 'x'.repeat(100), content: 'x'.repeat(1000) }));
  assert.equal(kit.validate(value).data.length, 200);
  assert.ok(Buffer.byteLength(kit.renderHTML(value)) < 200000);
  value.data.forEach(row => { row.label = '界'.repeat(160); row.category = '界'.repeat(100); row.status = '界'.repeat(40); });
  assert.throws(() => kit.validate(value), /120KB/);
});

test('UMD installs only the kit API in a browser context', () => {
  const window = {}, source = fs.readFileSync(path.join(__dirname, '../lib/studio/runtime/dashboard-kit.js'), 'utf8');
  vm.runInNewContext(source, { window, TextEncoder });
  assert.deepEqual(Object.keys(window), ['BLKDashboardKit']);
  assert.equal(typeof window.BLKDashboardKit.renderHTML, 'function');
});

const adoptionFixture = {
  request: 'Quiero un workflow de adopción de IA en tres fases: fundamentos, primer agente y cowork donde la IA ejecuta. Cada fase debe estar claramente delimitada y contener varios elementos de checklist que pueda marcar de forma independiente.',
  config: {
    version: 1, title: 'Adopción de IA', description: 'Plan educativo sintético de tres fases con pasos independientes.',
    theme: { dark: false, accent: '#60A5FA' }, template: 'projects',
    data: [{ date: '2026-01-01', category: 'Aprendizaje', label: 'Registro sintético', value: 1, status: 'Planned' }],
    components: [
      { id: 'adoption', type: 'workflow', title: 'De los fundamentos al cowork', phases: [
        { id: 'fundamentals', title: 'Fundamentos', description: 'Comprender las capacidades y los límites de la IA antes de delegar.', items: [
          { id: 'limits', label: 'Explicar capacidades y límites', detail: 'Comparar un resultado correcto con uno que necesita verificación.' },
          { id: 'prompt', label: 'Practicar una instrucción con contexto', checked: false, detail: 'Definir objetivo, restricciones y criterios de aceptación.' }
        ] },
        { id: 'first-agent', title: 'Primer agente', description: 'Crear y probar un agente acotado con supervisión humana.', items: [
          { id: 'scope', label: 'Definir el objetivo del agente', checked: true },
          { id: 'test-agent', label: 'Probar el agente y revisar su resultado', detail: 'Usar datos sintéticos y documentar un caso fallido.' }
        ] },
        { id: 'cowork', title: 'Cowork: la IA ejecuta', description: 'Delegar la ejecución con permisos y puntos de revisión explícitos.', items: [
          { id: 'permissions', label: 'Delimitar permisos y aprobaciones', detail: 'Decidir qué acciones requieren revisión humana.' },
          { id: 'execute', label: 'Dejar que la IA ejecute y verificar la entrega', checked: false }
        ] }
      ] },
      { id: 'filters', type: 'filters', title: 'Filtros' },
      { id: 'table', type: 'table', title: 'Registros sintéticos' },
      { id: 'form', type: 'form', title: 'Editor sintético' }
    ]
  }
};
const workflowConfig = () => copy(adoptionFixture.config);

let chromium;
try { chromium = require('playwright').chromium; } catch (_) {}
test('browser runtime filters all views, sorts/pages tables, renders SVG and works on mobile', { skip: !chromium }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const requests = [], errors = [];
    page.on('request', request => requests.push(request.url())); page.on('pageerror', error => errors.push(error.message));
    const value = config(); value.components.push({ id: 'filters2', type: 'filters', title: 'Second filters' });
    const reopen = copy(value);
    reopen.data[0].label = '</script><script>throw Error("must not execute")</script>&\u2028\u2029';
    const restored = await page.evaluate(html => {
      const inert = new DOMParser().parseFromString(html, 'text/html');
      return JSON.parse(inert.querySelector('#blk-dashboard-config[type="application/json"]').textContent);
    }, kit.renderHTML(reopen));
    assert.deepEqual(kit.validate(restored), kit.validate(reopen));
    await page.setContent(kit.renderHTML(value));
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), '36');
    assert.equal(await page.locator('#dashboard-table tbody tr').count(), 8);
    assert.equal(await page.locator('svg').count(), 2);
    await page.locator('#dashboard-filters [data-filter="category"]').selectOption('Online');
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), '12');
    assert.equal(await page.locator('[data-component-id="filters2"] [data-filter="category"]').inputValue(), 'Online');
    const expected = value.data.filter(r => r.category === 'Online').reduce((sum, r) => sum + r.value, 0);
    assert.equal(await page.locator('[data-component-id="total"] [data-metric-value]').textContent(), new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(expected));
    assert.match(await page.locator('[data-component-id="breakdown"] svg desc').textContent(), /Online/);
    assert.doesNotMatch(await page.locator('[data-component-id="breakdown"] svg desc').textContent(), /Direct/);
    await page.locator('#dashboard-table [data-page="next"]').click();
    assert.equal(await page.locator('#dashboard-table tbody tr').count(), 4);
    await page.locator('#dashboard-table [data-sort="value"]').click();
    const ascending = await page.locator('#dashboard-table tbody td:last-of-type').allTextContents();
    const numeric = await page.locator('#dashboard-table tbody tr').evaluateAll(rows => rows.map(r => Number(r.children[3].textContent.replaceAll(',', ''))));
    assert.deepEqual(numeric, numeric.slice().sort((a, b) => a - b)); assert.equal(ascending.length, 8);
    await page.locator('#dashboard-filters [data-filter="search"]').fill('no matching record');
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), '0');
    assert.match(await page.locator('#dashboard-table tbody').textContent(), /No records/); assert.equal(await page.locator('svg').count(), 0);
    await page.locator('#dashboard-filters button').click();
    await page.locator('#dashboard-filters [data-filter="start"]').fill('2026-03-01');
    await page.locator('#dashboard-filters [data-filter="end"]').fill('2026-03-05');
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), '5');
    await page.locator('#dashboard-filters [data-filter="status"]').selectOption('Won');
    const count = value.data.filter(r => r.date >= '2026-03-01' && r.date <= '2026-03-05' && r.status === 'Won').length;
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), String(count));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await page.close();
    for (const chartType of ['bar', 'line', 'donut']) {
      const chartPage = await browser.newPage();
      const sample = kit.createConfig(chartType, value); sample.data[0].value = -100;
      await chartPage.setContent(kit.renderHTML(sample));
      assert.equal(await chartPage.locator('svg').count(), 2);
      assert.doesNotMatch(await chartPage.locator('svg').first().getAttribute('viewBox'), /NaN|Infinity/);
      assert.equal(await chartPage.locator('svg title').first().textContent(), 'By category');
      await chartPage.close();
    }
  } finally { await browser.close(); }
});

test('workflow schema and catalog document authored phases, not shared status data', () => {
  const value = workflowConfig(), original = copy(value), normalized = kit.validate(value);
  assert.deepEqual(value, original);
  assert.equal(normalized.components[0].span, 12);
  assert.equal(normalized.components[0].phases[0].items[0].checked, false);
  assert.equal(normalized.components[0].phases[1].items[0].checked, true);
  const context = kit.context(adoptionFixture.request, config());
  assert.ok(context.components.workflow); assert.ok(context.components.board);
  assert.match(context.components.workflow.description, /1\.\.6/);
  assert.match(context.components.workflow.description, /1\.\.12/);
  assert.match(context.components.board.description, /Shared data/);
  assert.ok(context.guidance.some(line => /Workflow is different/.test(line)));
  const componentSchema = kit.schema.properties.components.items;
  assert.deepEqual(componentSchema.then.required, ['phases']);
  assert.deepEqual(componentSchema.else.not.required, ['phases']);
  const phases = componentSchema.properties.phases;
  assert.equal(phases.minItems, 1); assert.equal(phases.maxItems, 6);
  assert.equal(phases.items.additionalProperties, false);
  assert.equal(phases.items.properties.items.items.additionalProperties, false);
  assert.equal(phases.items.properties.items.items.properties.checked.default, false);
  assert.deepEqual(kit.validate(normalized), normalized);
  assert.equal(kit.createConfig(adoptionFixture.request).components.some(c => c.type === 'workflow'), false);
});

test('workflow strict validation rejects unsafe nested values, duplicates and bounds', () => {
  const mutations = [
    c => { delete c.phases; }, c => { c.phases = []; }, c => { c.phases = Array(7).fill(c.phases[0]); },
    c => { c.phases[0].items = []; }, c => { c.phases[0].items = Array(13).fill(c.phases[0].items[0]); },
    c => { c.phases[0].items = new Array(1); }, c => { c.phases = new Array(1); },
    c => { delete c.phases[0].description; }, c => { delete c.phases[0].id; }, c => { delete c.phases[0].title; },
    c => { delete c.phases[0].items; }, c => { delete c.phases[0].items[0].label; }, c => { delete c.phases[0].items[0].id; },
    c => { c.phases[0].title = 'x'.repeat(101); }, c => { c.phases[0].description = 'x'.repeat(501); },
    c => { c.phases[0].items[0].label = 'x'.repeat(301); }, c => { c.phases[0].items[0].detail = 'x'.repeat(501); },
    ...[null, 0, 'false', undefined].map(checked => c => { c.phases[0].items[0].checked = checked; }),
    c => { c.phases[0].items[0].detail = undefined; }, c => { c.phases[0].description = null; },
    c => { c.phases[0].id = 'x'.repeat(41); }, c => { c.phases[0].items[0].id = 'bad:id'; },
    c => { c.phases[0].id = '" onload=alert(1)'; }, c => { c.phases[0].items[0].id = ''; },
    c => { c.phases[1].id = c.phases[0].id; },
    c => { c.phases[1].items[0].id = c.phases[0].items[0].id; },
    c => { c.phases[0].items[0].id = c.phases[2].id; },
    c => { c.phases[0].html = '<script>'; }, c => { c.phases[0].items[0].url = 'https://example.com'; },
    c => { c.phases[0].items[0].onclick = 'alert(1)'; },
    c => { Object.defineProperty(c.phases[0], 'title', { get() { throw Error('executed getter'); } }); },
    c => { Object.defineProperty(c.phases[0].items, 0, { get() { throw Error('executed getter'); } }); },
    c => { Object.defineProperty(c.phases[0].items[0], '__proto__', { value: {}, enumerable: true }); },
    c => { c.phases[0].items[0] = Object.create({ label: 'inherited' }); },
    c => { c.phases.extra = 'unsafe'; }
  ];
  for (const mutate of mutations) { const value = workflowConfig(); mutate(value.components[0]); assert.throws(() => kit.validate(value)); }
  for (const type of ['metric', 'table', 'chart', 'filters', 'text', 'board', 'form', 'insights']) {
    const value = workflowConfig(); value.components[0].type = type;
    assert.throws(() => kit.validate(value), /only allowed for workflow/);
  }
  const maximum = workflowConfig();
  maximum.components[0].phases = Array.from({ length: 6 }, (_, p) => ({ id: 'phase' + p, title: 'x'.repeat(100), description: 'x'.repeat(500),
    items: Array.from({ length: 12 }, (_, i) => ({ id: 'item' + p + '_' + i, label: 'x'.repeat(300), detail: 'x'.repeat(500), checked: false })) }));
  assert.equal(kit.validate(maximum).components[0].phases.length, 6);
  assert.ok(Buffer.byteLength(kit.renderHTML(maximum)) < 200000);
  maximum.components[0].phases.forEach(phase => phase.items.forEach(item => { item.detail = '界'.repeat(500); }));
  assert.throws(() => kit.validate(maximum), /120KB/);
  const minimum = workflowConfig(); minimum.components[0].phases = [{ id: 'overall', title: '', description: '', items: [{ id: 'single', label: '' }] }];
  assert.equal(kit.validate(minimum).components[0].phases[0].items[0].checked, false);
  const repeated = workflowConfig(); repeated.components.push({ ...copy(repeated.components[0]), id: 'second' });
  assert.doesNotThrow(() => kit.validate(repeated));
});

test('Chromium renders Spanish AI adoption phases with independent memory-only checklists', async () => {
  assert.ok(chromium, 'Playwright Chromium must be available for the workflow functional test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    const value = workflowConfig(), original = copy(value), html = kit.renderHTML(value);
    const preview = page.locator('#workflow-preview');
    await page.setContent('<iframe id="workflow-preview" sandbox="allow-scripts allow-forms" title="Isolated workflow preview"></iframe>');
    await preview.evaluate((iframe, source) => { iframe.srcdoc = source; }, html);
    const frame = page.frameLocator('#workflow-preview'), workflow = frame.locator('[data-component-id="adoption"]');
    await workflow.locator('[data-workflow-item="limits"]').waitFor();
    assert.equal(await workflow.evaluate(() => { try { return !!parent.document; } catch (error) { return error.name; } }), 'SecurityError');
    assert.ok(await workflow.locator('.workflow-phase').first().evaluate(n => parseFloat(getComputedStyle(n).borderLeftWidth) >= 4));
    assert.equal(await workflow.locator('.workflow-phase').nth(1).evaluate(n => getComputedStyle(n, '::before').content), '"↓"');
    assert.deepEqual(await workflow.locator('.workflow-phase h3').allTextContents(), ['Fundamentos', 'Primer agente', 'Cowork: la IA ejecuta']);
    assert.equal(await workflow.locator('[data-workflow-phase]').count(), 3);
    assert.equal(await workflow.locator('input[type="checkbox"]').count(), 6);
    assert.equal(await workflow.locator('.workflow-purpose').count(), 3);
    assert.equal(await workflow.locator('.workflow-detail').count(), 4);
    const item = id => workflow.locator('[data-workflow-item="' + id + '"]');
    const count = key => workflow.locator('[data-workflow-count="' + key + '"]');
    assert.match(await count('overall').textContent(), /^1 \/ 6 completed · 17%$/);
    await item('limits').check();
    assert.match(await count('phase:fundamentals').textContent(), /^1 \/ 2 completed · 50%$/);
    assert.match(await count('overall').textContent(), /^2 \/ 6 completed · 33%$/);
    assert.equal(await item('prompt').isChecked(), false); assert.equal(await item('permissions').isChecked(), false);
    assert.equal(await workflow.locator('[data-workflow-progress="overall"]').evaluate(p => p.value), 2);
    await item('limits').uncheck(); assert.match(await count('overall').textContent(), /^1 \/ 6/);
    await item('limits').focus(); await item('limits').press('Space');
    assert.equal(await item('limits').isChecked(), true); assert.equal(await item('limits').evaluate(n => n === document.activeElement), true);
    await item('execute').check(); assert.match(await count('phase:cowork').textContent(), /^1 \/ 2/);
    await frame.locator('#dashboard-filters [data-filter="search"]').fill('no records');
    assert.equal(await workflow.locator('input[type="checkbox"]').count(), 6);
    assert.equal(await item('limits').isChecked(), true); assert.equal(await item('execute').isChecked(), true);
    await frame.locator('#dashboard-filters button').click();
    await frame.locator('[data-component-id="table"] [data-sort="label"]').click();
    const form = frame.locator('[data-record-form="form"]');
    await form.locator('[data-record-select]').selectOption('0');
    await form.locator('[data-record-field="label"]').fill('Registro editado');
    await form.locator('button[type="submit"]').click();
    assert.match(await form.locator('.form-message').textContent(), /updated/);
    assert.equal(await item('limits').isChecked(), true); assert.equal(await item('execute').isChecked(), true);
    assert.match(await count('overall').textContent(), /^3 \/ 6 completed · 50%$/);
    for (const id of ['prompt', 'test-agent', 'permissions']) await item(id).check();
    assert.match(await count('overall').textContent(), /^6 \/ 6 completed · 100%$/);
    assert.deepEqual(await workflow.locator('[data-workflow-phase] progress').evaluateAll(ps => ps.map(p => p.value)), [2, 2, 2]);
    await item('execute').uncheck(); assert.match(await count('overall').textContent(), /^5 \/ 6/);
    assert.deepEqual(await frame.locator('#blk-dashboard-config').evaluate(n => JSON.parse(n.textContent)), kit.validate(original));
    assert.deepEqual(value, original);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await workflow.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await preview.evaluate((iframe, source) => { iframe.srcdoc = source; }, html);
    await item('limits').waitFor();
    assert.equal(await item('limits').isChecked(), false); assert.equal(await item('execute').isChecked(), false);
    assert.equal(await item('scope').isChecked(), true); assert.match(await count('overall').textContent(), /^1 \/ 6/);
    assert.equal(await frame.locator('[data-component-id="table"] tbody').textContent().then(t => t.includes('Registro editado')), false);
    const injection = '</script><img src=x onerror=alert(1)>';
    const escaped = workflowConfig(); escaped.components[0].phases[0].items[0].label = injection;
    escaped.components[0].phases[0].items[0].detail = injection;
    escaped.components.push({ ...copy(escaped.components[0]), id: 'another-workflow' });
    await preview.evaluate((iframe, source) => { iframe.srcdoc = source; }, kit.renderHTML(escaped));
    await item('limits').waitFor(); assert.equal(await workflow.locator('.workflow-label').first().textContent(), injection);
    await item('limits').check();
    assert.equal(await frame.locator('[data-component-id="another-workflow"] [data-workflow-item="limits"]').isChecked(), false);
    assert.ok(await workflow.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(n => n.id); return new Set(ids).size === ids.length; }));
    assert.equal(await frame.locator('img').count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});

    test('standalone HTML persists records and workflow choices across reloads without changing its configuration', async () => {
      assert.ok(chromium, 'Playwright Chromium must be available');
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const value = workflowConfig(), html = kit.renderHTML(value), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://127.0.0.1/miniapp', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto('http://127.0.0.1/miniapp');
        const item = page.locator('[data-component-id="adoption"] [data-workflow-item="limits"]');
        await item.check();
        const form = page.locator('[data-record-form="form"]');
        await form.locator('[data-record-select]').selectOption('0');
        await form.locator('[data-record-field="label"]').fill('Cambio persistente');
        await form.locator('button[type="submit"]').click();
        assert.match(await form.locator('.form-message').textContent(), /updated/);
        assert.doesNotMatch(await form.locator('.form-message').textContent(), /No se han guardado/);
        await page.reload();
        assert.equal(await item.isChecked(), true);
        assert.match(await page.locator('[data-component-id="table"] tbody').textContent(), /Cambio persistente/);
        assert.deepEqual(await page.locator('#blk-dashboard-config').evaluate(node => JSON.parse(node.textContent)), kit.validate(value));
        await form.locator('[data-record-select]').selectOption('0');
        await form.locator('[data-record-delete]').click();
        await item.uncheck();
        await page.reload();
        assert.equal(await item.isChecked(), false);
        assert.doesNotMatch(await page.locator('[data-component-id="table"] tbody').textContent(), /Cambio persistente/);
        assert.deepEqual(errors, []);
      } finally { await browser.close(); }
    });

    function richConfig() {
  const value = config();
  value.components.push(...['board', 'insights', 'form'].map(type => ({ id: type, type, title: type })));
  return value;
}

test('rich declarative types retain v1 defaults, safety, original rows and budgets', () => {
  const value = richConfig(), original = copy(value), normalized = kit.validate(value);
  assert.deepEqual(value, original);
  for (const type of ['board', 'form', 'insights']) {
    assert.ok(kit.schema.properties.components.items.properties.type.enum.includes(type));
    assert.equal(normalized.components.find(c => c.type === type).span, 12);
    assert.ok(kit.registry[type].description);
    const unsafe = copy(value); unsafe.components.find(c => c.type === type).onSubmit = 'alert(1)';
    assert.throws(() => kit.validate(unsafe), /unsafe property/);
  }
  const context = kit.context('add a board, form and insights', config());
  for (const type of ['board', 'form', 'insights']) assert.ok(context.components[type]);
  value.components.find(c => c.type === 'board').title = '<img src=x onerror=alert(1)>';
  const html = kit.renderHTML(value);
  assert.match(html, /href="#heading-board"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img|<link|<iframe|\sonclick=/i);
  assert.match(html, /Record editor/);
  assert.doesNotMatch(html, /Synthetic session editor|reload resets it/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|eval|sessionStorage)\b|\.innerHTML\s*=/);
  assert.match(script, /localStorage\.setItem/);
  value.components = Array.from({ length: 16 }, (_, i) => ({ id: 'rich' + i, type: ['board', 'form', 'insights'][i % 3], title: 'x'.repeat(100), content: 'x'.repeat(1000) }));
  value.data = Array.from({ length: 200 }, (_, i) => ({ date: '2026-01-01', category: 'x'.repeat(100), label: 'x'.repeat(160), value: i, status: 'x'.repeat(40) }));
  assert.ok(Buffer.byteLength(kit.renderHTML(value)) < 200000);
});

test('rich browser views compute facts and CRUD stays in synchronized synthetic memory', { skip: !chromium }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [], requests = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    const value = richConfig();
    value.data = [
      { date: '2026-01-01', category: 'Alpha', label: 'One', value: -10, status: 'Ready' },
      { date: '2026-01-02', category: 'Beta', label: 'Two', value: 30, status: 'Done' }
    ];
    value.components.push({ id: 'form2', type: 'form', title: 'Second editor' }, { id: 'filters2', type: 'filters', title: 'Second filters' });
    const original = kit.validate(value);
    await page.setContent(kit.renderHTML(value));
    assert.equal(await page.locator('.board-lane').count(), 2);
    assert.equal(await page.locator('.record-card').count(), 2);
    assert.deepEqual(await page.locator('.insight-grid dd').allTextContents(), ['2', '20', '10', '-10 – 30', '2026-01-01 – 2026-01-02']);
    const form = page.locator('[data-record-form="form"]'), message = form.locator('.form-message');
    await form.locator('button[type="submit"]').click();
    assert.match(await message.textContent(), /required/);
    const fill = async row => { for (const [field, v] of Object.entries(row)) await form.locator('[data-record-field="' + field + '"]').fill(String(v)); };
    const injection = '<img src=x onerror=alert(1)>&';
    await fill({ date: '2026-01-03', category: 'New category', label: injection, value: -2.5, status: 'New status' });
    await form.locator('[data-record-field="status"]').evaluate(input => { input.value = 'x'.repeat(41); });
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /maximum/);
    await form.locator('[data-record-field="status"]').fill('New status');
    await form.locator('[data-record-field="date"]').fill('');
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /required/);
    await form.locator('[data-record-field="date"]').evaluate(input => { input.type = 'text'; input.value = '2026-02-30'; });
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /calendar date/);
    await form.locator('[data-record-field="date"]').evaluate(input => { input.type = 'date'; });
    await form.locator('[data-record-field="date"]').fill('2026-01-03');
    await form.locator('[data-record-field="value"]').fill('1e309');
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /finite|required/);
    await form.locator('[data-record-field="value"]').fill('-2.5');
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /added/);
        assert.match(await message.textContent(), /No se han guardado los cambios/);
        assert.equal(await page.locator('.record-card').count(), 3);
    assert.equal(await page.locator('.record-card h4').filter({ hasText: injection }).textContent(), injection);
    assert.equal(await page.locator('img').count(), 0);
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), '3');
    assert.equal(await page.locator('[data-component-id="total"] [data-metric-value]').textContent(), '17.5');
    assert.equal(await page.locator('[data-record-select="form2"] option').count(), 4);
    await page.locator('#dashboard-filters [data-filter="category"]').selectOption('New category');
    assert.equal(await page.locator('.record-card').count(), 1);
    assert.equal(await page.locator('.insight-grid dd').first().textContent(), '1');
    assert.equal(await page.locator('[data-component-id="filters2"] [data-filter="category"]').inputValue(), 'New category');
    await form.locator('[data-record-select]').selectOption('2');
    await fill({ label: 'Edited record', value: 12, category: 'Updated category', status: 'Updated status' });
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /updated/);
    assert.equal(await page.locator('#dashboard-filters [data-filter="category"]').inputValue(), '');
    assert.ok((await page.locator('#dashboard-filters [data-filter="category"] option').allTextContents()).includes('Updated category'));
    assert.ok(!(await page.locator('#dashboard-filters [data-filter="status"] option').allTextContents()).includes('New status'));
    await page.locator('[data-record-select="form2"]').selectOption('2');
    assert.equal(await page.locator('[data-component-id="form2"] [data-record-field="label"]').inputValue(), 'Edited record');
    await form.locator('[data-record-select]').selectOption('2'); await form.locator('[data-record-delete]').click();
    assert.match(await message.textContent(), /deleted/);
    assert.equal(await page.locator('.record-card').count(), 2);
    assert.equal(await page.locator('[data-component-id="form2"] [data-record-delete]').isDisabled(), true);
    assert.deepEqual(await page.locator('#blk-dashboard-config').evaluate(node => JSON.parse(node.textContent)), original);
    await page.locator('#dashboard-filters [data-filter="search"]').fill('no match');
    assert.match(await page.locator('[data-component-id="board"]').textContent(), /No records/);
    assert.match(await page.locator('[data-component-id="insights"]').textContent(), /No records/);
    assert.equal(await form.locator('[data-record-select] option').count(), 1);
    await page.locator('#dashboard-filters button').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.locator('.section-nav a[href="#heading-board"]').click();
    assert.equal(await page.evaluate(() => location.hash), '#heading-board');
    await page.setContent(kit.renderHTML(value)); assert.equal(await page.locator('.record-card').count(), 2);
    const full = richConfig(); full.data = Array.from({ length: 200 }, () => copy(value.data[0]));
    await page.setContent(kit.renderHTML(full));
    await fill({ date: '2026-01-03', category: 'C', label: 'New', value: 1, status: 'S' });
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /200 records/);
    await form.locator('[data-record-select]').selectOption('0'); await fill({ value: 5 });
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /updated/);
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), '200');
    const budget = richConfig();
    budget.data = Array.from({ length: 199 }, () => ({ date: '2026-01-01', category: 'x'.repeat(100), label: 'x'.repeat(160), value: 1, status: 'x'.repeat(40) }));
    let padding = Math.floor((119900 - Buffer.byteLength(JSON.stringify(kit.validate(budget)))) / 2);
    for (const row of budget.data) { const n = Math.min(160, padding); row.label = '界'.repeat(n) + 'x'.repeat(160 - n); padding -= n; }
    assert.ok(Buffer.byteLength(JSON.stringify(kit.validate(budget))) >= 119898);
    await page.setContent(kit.renderHTML(budget));
    await fill({ date: '2026-01-03', category: '界'.repeat(100), label: '界'.repeat(160), value: 1, status: '界'.repeat(40) });
    await form.locator('button[type="submit"]').click(); assert.match(await message.textContent(), /120KB/);
    assert.equal(await page.locator('[data-component-id="records"] [data-metric-value]').textContent(), '199');
    assert.deepEqual(await page.locator('#blk-dashboard-config').evaluate(node => JSON.parse(node.textContent)), kit.validate(budget));
    const empty = richConfig(); empty.data = [];
    await page.setContent(kit.renderHTML(empty));
    assert.match(await page.locator('[data-component-id="board"]').textContent(), /No records/);
    await fill({ date: '2026-01-03', category: 'C', label: 'First record', value: 0, status: 'Ready' });
    await form.locator('button[type="submit"]').click();
    assert.equal(await page.locator('.record-card').count(), 1);
    assert.equal(await page.locator('.insight-grid dd').nth(1).textContent(), '0');
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  } finally { await browser.close(); }
});
