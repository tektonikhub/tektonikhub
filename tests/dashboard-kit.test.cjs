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
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|eval|localStorage)\b|\.innerHTML\s*=/);
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
  assert.match(html, /Synthetic session editor/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|eval|localStorage|sessionStorage)\b|\.innerHTML\s*=/);
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
