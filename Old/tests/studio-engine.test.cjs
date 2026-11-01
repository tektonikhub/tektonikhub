'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const enginePath = path.join(__dirname, '..', 'assets', 'js', 'studio-engine.js');
const engine = require(enginePath);
const { createSpec, renderHTML, explainChanges } = engine;

function scriptBodies(html) {
  return Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = '';
    this.hidden = false;
    this._text = '';
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() { this.focused = true; }
}

// A minimal, network-free DOM double exercises generated handlers, not just their source text.
function runtime(kind, options = {}) {
  const html = renderHTML({ ...createSpec(kind, null), kind, search: options.search !== false });
  const elements = {};
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements[match[1]] = new Element();
  if (options.search === false) delete elements.search;
  if (kind === 'calculator') {
    elements.hours.value = '4';
    elements.rate.value = '30';
    elements.team.value = '5';
    elements['calculator-form'].reportValidity = () => true;
    ['Finanzas · conciliación de gastos', 'Equipo · informes semanales', 'Operaciones · revisión de solicitudes'].forEach(text => {
      const item = new Element('li');
      item.textContent = text;
      elements['scenario-list'].appendChild(item);
    });
  }
  function setupForm(id, values) {
    if (!elements[id]) return;
    const fields = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
    elements[id].elements = { namedItem: name => fields[name] };
    elements[id].reportValidity = () => true;
    elements[id].reset = () => { Object.values(fields).forEach(field => { field.value = ''; }); };
    return fields;
  }
  const requestFields = setupForm('request-form', { name: '', subject: '', priority: 'Normal', details: '' });
  const taskFields = setupForm('task-form', { task: '' });
  const document = {
    body: { dataset: { kind } },
    getElementById: id => elements[id] || null,
    createElement: tag => new Element(tag),
    querySelector: () => null
  };
  const context = vm.createContext({ document, Intl, CSS: { escape: value => value } });
  const script = scriptBodies(html)[0].replace(/\}\)\(\);$/, 'globalThis.app = {calculateSavings, submitRequest, addTask, moveTask, addEntry, filterData};})();');
  new vm.Script(script).runInContext(context);
  return { elements, app: context.app, requestFields, taskFields };
}

function event() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

function snapshot(value) { return JSON.parse(JSON.stringify(value)); }

test('CommonJS and browser UMD expose exactly the public pure API', () => {
  assert.deepEqual(Object.keys(engine).sort(), ['createSpec', 'explainChanges', 'renderHTML']);
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(enginePath, 'utf8'), browser);
  assert.equal(typeof browser.window.BLKStudioEngine.renderHTML, 'function');
  assert.equal(browser.window.BLKStudioEngine.createSpec('kanban').kind, 'kanban');
});

test('initial Spanish and English prompts select the appropriate template', () => {
  for (const [prompt, kind] of [
    ['Control de gastos', 'calculator'], ['Expenses tracker', 'calculator'], ['ROI del equipo', 'calculator'],
    ['Una calculadora', 'calculator'], ['Formulario de acceso', 'form'], ['Gestionar solicitudes', 'form'],
    ['Tablero kanban', 'kanban'], ['Seguimiento de tareas', 'kanban'], ['Dashboard financiero', 'dashboard'],
    ['Una app para mi equipo', 'dashboard'], ['', 'dashboard']
  ]) assert.equal(createSpec(prompt).kind, kind, prompt);
});

test('specification is deterministic, serializable and contains only required fields', () => {
  const spec = createSpec('Dashboard azul oscuro con gráfico y buscador');
  assert.deepEqual(spec, createSpec('Dashboard azul oscuro con gráfico y buscador'));
  assert.deepEqual(spec, snapshot(spec));
  assert.deepEqual(Object.keys(spec).sort(), ['accent', 'area', 'chart', 'compact', 'dark', 'description', 'kind', 'search', 'title']);
  assert.equal(typeof spec.area, 'string');
  assert.ok(spec.title.length > 0);
  assert.equal(createSpec(null).kind, 'dashboard');
});

test('followups preserve kind, title and description without mutating frozen input', () => {
  const previous = Object.freeze(createSpec('Dashboard de gastos, llámalo "Ahorro del equipo"'));
  const saved = snapshot(previous);
  const next = createSpec('Añade un gráfico de tareas en oscuro con acento violeta y compacta', previous);
  assert.equal(next.kind, 'calculator');
  assert.equal(next.title, 'Ahorro del equipo');
  assert.equal(next.description, previous.description);
  assert.equal(next.dark, true);
  assert.equal(next.accent, '#7C3AED');
  assert.equal(next.compact, true);
  assert.equal(next.chart, true);
  assert.deepEqual(previous, saved);
});

test('only explicit template switches change a followup kind', () => {
  const original = createSpec('Dashboard');
  assert.equal(createSpec('Añade solicitudes y tareas', original).kind, 'dashboard');
  for (const [prompt, kind] of [['convierte a kanban', 'kanban'], ['cambia a un formulario', 'form'], ['transforma en calculadora', 'calculator']]) {
    const next = createSpec(prompt, original);
    assert.equal(next.kind, kind);
    assert.equal(next.title, original.title);
  }
  assert.equal(createSpec('cambia a algo nuevo', original).kind, 'dashboard');
});

test('theme, accent, density, chart and search can be added and removed', () => {
  let spec = createSpec('dashboard oscuro azul compacto sin gráfico sin buscador');
  assert.equal(spec.dark, true);
  assert.equal(spec.accent, '#2563EB');
  assert.equal(spec.compact, true);
  assert.equal(spec.chart, false);
  assert.equal(spec.search, false);
  spec = createSpec('tema claro verde espacioso añade el gráfico agrega un buscador', spec);
  assert.equal(spec.dark, false);
  assert.equal(spec.accent, '#0B7A48');
  assert.equal(spec.compact, false);
  assert.equal(spec.chart, true);
  assert.equal(spec.search, true);
  spec = createSpec('acento amarillo elimina el gráfico quita el buscador', spec);
  assert.equal(spec.accent, '#FEFF44');
  assert.equal(spec.chart, false);
  assert.equal(spec.search, false);
});

test('the last theme or feature directive wins', () => {
  const spec = createSpec('dashboard oscuro claro azul violeta compacto espacioso sin gráfico añade gráfico con buscador quita buscador');
  assert.equal(spec.dark, false);
  assert.equal(spec.accent, '#7C3AED');
  assert.equal(spec.compact, false);
  assert.equal(spec.chart, true);
  assert.equal(spec.search, false);
});

test('custom Spanish titles and followup title changes are supported', () => {
  for (const prompt of ['llámalo Mi espacio', 'titulo: Mi espacio', 'título "Mi espacio"', "llámalo 'Mi espacio'"]) {
    assert.equal(createSpec(prompt).title, 'Mi espacio');
  }
  const prior = createSpec('kanban');
  assert.equal(createSpec('título: Nuevo tablero', prior).title, 'Nuevo tablero');
  assert.equal(createSpec('claro', prior).title, prior.title);
});

test('all user-derived HTML text is escaped literally and never enters script bodies', () => {
  const payload = '</title><script>globalThis.PWNED=1</script><img src=x onerror="alert(1)">&\'\u2028\u2029';
  const spec = { ...createSpec('dashboard'), title: payload, description: payload, area: payload };
  const html = renderHTML(spec);
  const escaped = '&lt;/title&gt;&lt;script&gt;globalThis.PWNED=1&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;\u2028\u2029';
  assert.ok(html.includes('<title>' + escaped + '</title>'));
  assert.ok(html.includes('<h1>' + escaped + '</h1>'));
  assert.ok(html.includes('<p class="description">' + escaped + '</p>'));
  assert.ok(html.includes('<span class="eyebrow">' + escaped + '</span>'));
  assert.equal(scriptBodies(html).length, 1);
  assert.ok(!scriptBodies(html)[0].includes('PWNED'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes(payload));
  assert.ok(renderHTML(createSpec('llámalo ' + payload)).includes(escaped.trim()));
});

test('untrusted spec properties cannot inject CSS, classes or template keys', () => {
  const html = renderHTML({ kind: 'constructor', accent: "red;} </style><script>alert('x')</script>", dark: 'onclick=evil', compact: 'bad', title: 'Safe' });
  assert.match(html, /data-kind="dashboard" data-theme="light" class=""/);
  assert.match(html, /--accent:#FEFF44;/);
  assert.equal(scriptBodies(html).length, 1);
  assert.ok(!html.includes("alert('x')"));
});

test('every template has a complete offline document, restrictive CSP and valid JavaScript', () => {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  for (const kind of ['dashboard', 'calculator', 'form', 'kanban']) {
    const html = renderHTML(createSpec(kind));
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.endsWith('</body></html>'));
    assert.ok(html.includes('content="' + policy + '"'));
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<style>'));
    assert.match(html, /<html lang="es">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /class="sidebar"/);
    assert.match(html, /@media\(max-width:700px\)/);
    assert.doesNotMatch(html, /https?:|\/\/|\b(?:src|action)\s*=|\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|postMessage)\b|@import|url\s*\(/i);
    assert.equal(scriptBodies(html).length, 1);
    for (const source of scriptBodies(html)) assert.doesNotThrow(() => new vm.Script(source));
    assert.match(html, /Sin IA|sin IA|No hay IA/);
  }
});

test('browser selectors expose titles, followup themes, calculator inputs and form submission', () => {
  for (const kind of ['dashboard', 'calculator', 'form', 'kanban']) {
    const base = createSpec(kind + ', llámalo "Mi app de prueba"');
    for (const [theme, dark] of [['claro', false], ['oscuro', true]]) {
      const spec = createSpec(theme, base);
      const html = renderHTML(spec);
      assert.equal(spec.dark, dark);
      assert.ok(html.includes('<title>Mi app de prueba</title>'));
      assert.ok(html.includes('<h1>Mi app de prueba</h1>'));
      assert.ok(html.includes('data-theme="' + (dark ? 'dark' : 'light') + '"'));
    }
  }
  const calculator = renderHTML(createSpec('calculadora'));
  for (const id of ['hours', 'rate', 'team', 'savings']) assert.ok(calculator.includes('id="' + id + '"'));
  assert.ok(calculator.includes('<strong id="monthly-saving"><span id="savings">'));
  const form = renderHTML(createSpec('formulario'));
  assert.ok(form.includes('<form id="request-form">'));
  assert.ok(form.includes('<button id="add-request" class="primary" type="button">Añadir solicitud local</button>'));
  for (const kind of ['calculator', 'form', 'kanban']) assert.doesNotMatch(renderHTML(createSpec(kind)), /type="submit"/);
});

test('chart and search options control actual rendered components', () => {
  for (const kind of ['dashboard', 'calculator', 'form', 'kanban']) {
    const base = createSpec(kind);
    const disabled = renderHTML({ ...base, search: false, chart: false });
    const enabled = renderHTML({ ...base, search: true, chart: true });
    assert.ok(!disabled.includes('id="search"'));
    assert.ok(!disabled.includes('id="chart-heading"'));
    assert.ok(enabled.includes('id="search"'));
    assert.ok(enabled.includes('id="chart-heading"'));
  }
});

test('calculator computes hours, monthly and annual savings and rejects invalid inputs', () => {
  const { app, elements } = runtime('calculator');
  assert.deepEqual(snapshot(app.calculateSavings(4, 30, 5)), { hours: 80, monthly: 2400, annual: 28800 });
  assert.deepEqual(snapshot(app.calculateSavings(0, 30, 1)), { hours: 0, monthly: 0, annual: 0 });
  assert.deepEqual(snapshot(app.calculateSavings(1.5, 20, 2)), { hours: 12, monthly: 240, annual: 2880 });
  for (const values of [[-1, 30, 5], [169, 30, 5], [4, -2, 5], [4, 30, 0], [4, 30, 2.5], [Infinity, 30, 1], [4, NaN, 1], [4, 30, 10001], ['', 30, 1], [4, null, 1]]) {
    assert.equal(app.calculateSavings(...values), null);
  }
  elements.hours.value = '8';
  elements.hours.listeners.input(event());
  assert.equal(elements.savings.textContent, new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(4800));
  assert.equal(elements['hours-saved'].textContent, '160 h');
  const submit = event();
  elements['calculate-savings'].listeners.click(submit);
  assert.equal(elements['calculator-form'].listeners.submit, undefined);
  assert.equal(submit.prevented, true);
});

test('form button adds literal synthetic/local data, prevents navigation and clears the filter', () => {
  const { elements, requestFields } = runtime('form');
  assert.equal(elements['request-count'].textContent, '3');
  const injection = '<img src=x onerror=alert(1)>';
  requestFields.name.value = 'Persona de prueba';
  requestFields.subject.value = injection;
  requestFields.details.value = '</script><script>alert(1)</script>';
  elements.search.value = 'no match';
  const submit = event();
  elements['add-request'].listeners.click(submit);
  assert.equal(elements['request-form'].listeners.submit, undefined);
  assert.equal(submit.prevented, true);
  assert.equal(elements['request-count'].textContent, '4');
  assert.equal(elements.search.value, '');
  assert.equal(elements['request-list'].children[0].children[0].textContent, injection);
  assert.equal(elements['request-list'].children[0].children[0].tagName, 'SPAN');
  assert.match(elements['request-status'].textContent, /No se ha enviado/);
  assert.equal(requestFields.subject.value, '');
});

test('form validity and whitespace-only inputs do not create a request', () => {
  const { app, elements, requestFields } = runtime('form');
  requestFields.name.value = '   ';
  requestFields.subject.value = 'An example';
  app.submitRequest(event());
  assert.equal(elements['request-count'].textContent, '3');
  elements['request-form'].reportValidity = () => false;
  requestFields.name.value = 'Valid';
  app.submitRequest(event());
  assert.equal(elements['request-count'].textContent, '3');
});

test('explicit Enter performs one local action without submitting or consuming textarea newlines', () => {
  const { elements, requestFields } = runtime('form');
  requestFields.name.value = 'Persona'; requestFields.subject.value = 'Solicitud por teclado';
  const enter = { ...event(), key: 'Enter', target: new Element('input') };
  elements['request-form'].listeners.keydown(enter);
  assert.equal(enter.prevented, true);
  assert.equal(elements['request-count'].textContent, '4');
  requestFields.name.value = 'Persona'; requestFields.subject.value = 'No duplicar';
  for (const extra of [{ target: new Element('textarea') }, { isComposing: true }]) {
    const ignored = { ...event(), key: 'Enter', target: new Element('input'), ...extra };
    elements['request-form'].listeners.keydown(ignored);
    assert.equal(ignored.prevented, false);
    assert.equal(elements['request-count'].textContent, '4');
  }
  const repeated = { ...event(), key: 'Enter', target: new Element('input'), repeat: true };
  elements['request-form'].listeners.keydown(repeated);
  assert.equal(repeated.prevented, true);
  assert.equal(elements['request-count'].textContent, '4');
});

test('kanban required and whitespace-only values cannot add local tasks', () => {
  const { elements, taskFields } = runtime('kanban');
  taskFields.task.value = '   '; elements['add-task'].listeners.click(event());
  assert.equal(elements['task-count'].textContent, '5');
  taskFields.task.value = 'Tarea'; elements['task-form'].reportValidity = () => false;
  elements['add-task'].listeners.click(event());
  assert.equal(elements['task-count'].textContent, '5');
});

test('kanban adds tasks and changes statuses through functional controls', () => {
  const { app, elements, taskFields } = runtime('kanban');
  taskFields.task.value = '<script>not executed</script>';
  const submit = event();
  elements['add-task'].listeners.click(submit);
  assert.equal(elements['task-form'].listeners.submit, undefined);
  assert.equal(submit.prevented, true);
  assert.equal(elements['task-count'].textContent, '6');
  assert.equal(elements['todo-list'].children.at(-1).children[0].textContent, '<script>not executed</script>');
  app.moveTask(6, 'doing');
  assert.equal(elements['progress-count'].textContent, '3');
  app.moveTask(6, 'done');
  assert.equal(elements['done-count'].textContent, '2');
  const doneTask = elements['done-list'].children.at(-1);
  const select = doneTask.children[1].children[0];
  select.value = 'todo';
  select.listeners.change();
  assert.equal(elements['done-count'].textContent, '1');
  app.moveTask(6, 'invalid');
  app.moveTask(999, 'done');
  assert.equal(elements['done-count'].textContent, '1');
});

test('dashboard filters synthetic data and adds a demo entry', () => {
  const { app, elements } = runtime('dashboard');
  assert.equal(elements['entry-count'].textContent, '4');
  elements.search.value = 'finanzas';
  elements.search.listeners.input();
  assert.equal(elements['entry-count'].textContent, '1');
  assert.match(elements['entry-list'].textContent, /Informe mensual/);
  assert.equal(elements['entry-total'].textContent, new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(6400));
  elements.search.value = 'missing';
  app.filterData();
  assert.equal(elements['entry-empty'].hidden, false);
  elements['add-entry'].listeners.click();
  assert.equal(elements['entry-count'].textContent, '5');
  assert.equal(elements.search.value, '');
  assert.equal(elements['entry-empty'].hidden, true);
  assert.match(elements['entry-list'].children[0].textContent, /Entrada demo 5/);
});

test('search is accent-insensitive and works in every template', () => {
  for (const [kind, search, id] of [['form', 'revision', 'request-list'], ['kanban', 'planificacion', 'done-list']]) {
    const { app, elements } = runtime(kind);
    elements.search.value = search;
    app.filterData();
    assert.equal(elements[id].children.length, 1);
    assert.match(elements[id].textContent, kind === 'form' ? /Revisión/ : /planificación/);
  }
  const calculator = runtime('calculator');
  calculator.elements.search = new Element('input');
  calculator.elements.search.value = 'conciliacion';
  calculator.app.filterData();
  assert.equal(calculator.elements['scenario-list'].children[0].hidden, false);
  assert.equal(calculator.elements['scenario-list'].children[1].hidden, true);
});

test('all template runtimes initialize without storage or an optional search input', () => {
  for (const kind of ['dashboard', 'calculator', 'form', 'kanban']) {
    assert.doesNotThrow(() => runtime(kind, { search: false }));
  }
});

test('changes are explained briefly in Spanish without claims of real AI', () => {
  const previous = createSpec('dashboard');
  const next = createSpec('oscuro violeta compacta sin gráfico sin buscador', previous);
  const text = explainChanges(previous, next);
  assert.match(text, /tema oscuro/);
  assert.match(text, /color de acento/);
  assert.match(text, /compacto/);
  assert.match(text, /gráfico eliminado/);
  assert.match(text, /buscador eliminado/);
  assert.ok(text.length < 250);
  assert.match(explainChanges(null, previous), /sin IA ni backend/);
  assert.match(explainChanges(previous, previous), /Sin cambios reconocidos/);
});

test('rendering and explanations leave input unchanged', () => {
  const spec = Object.freeze(createSpec('formulario azul'));
  const saved = snapshot(spec);
  assert.equal(renderHTML(spec), renderHTML(spec));
  explainChanges(spec, spec);
  assert.deepEqual(spec, saved);
});
