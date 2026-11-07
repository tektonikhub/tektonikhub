/* Tektonik hub Studio declarative dashboard kit. No dependencies or generated executable code. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLKDashboardKit = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const fields = ['date', 'category', 'label', 'value', 'status'];
  const types = ['metric', 'table', 'chart', 'filters', 'text', 'board', 'form', 'insights', 'workflow'];
  const templateNames = ['sales', 'operations', 'projects'];
  const enumSchema = values => ({ type: 'string', enum: values });
  const stringSchema = maxLength => ({ type: 'string', maxLength });
  const componentProperties = {
    id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,39}$', maxLength: 40 },
    type: enumSchema(types), title: stringSchema(100),
    span: { type: 'integer', minimum: 1, maximum: 12 }, field: enumSchema(['value', 'label', 'category', 'date', 'status']),
    aggregation: enumSchema(['sum', 'avg', 'count']), chartType: enumSchema(['bar', 'line', 'donut']),
    groupBy: enumSchema(['category', 'date', 'status']),
    columns: { type: 'array', items: enumSchema(fields), minItems: 1, maxItems: 5, uniqueItems: true },
    pageSize: { type: 'integer', minimum: 1, maximum: 50 },
    fields: { type: 'array', items: enumSchema(['date', 'category', 'status', 'label']), minItems: 1, maxItems: 4, uniqueItems: true },
    content: stringSchema(1000),
    phases: { type: 'array', minItems: 1, maxItems: 6, items: {
      type: 'object', additionalProperties: false, required: ['id', 'title', 'description', 'items'], properties: {
        id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,39}$', maxLength: 40 },
        title: stringSchema(100), description: stringSchema(500),
        items: { type: 'array', minItems: 1, maxItems: 12, items: {
          type: 'object', additionalProperties: false, required: ['id', 'label'], properties: {
            id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,39}$', maxLength: 40 },
            label: stringSchema(300), checked: { type: 'boolean', default: false }, detail: stringSchema(500)
          }
        } }
      }
    } }
  };
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
    required: ['version', 'title', 'description', 'theme', 'template', 'data', 'components'],
    properties: {
      version: { const: 1 }, title: stringSchema(100), description: stringSchema(800),
      theme: { type: 'object', additionalProperties: false, required: ['dark', 'accent'], properties: { dark: { type: 'boolean' }, accent: { type: 'string', pattern: '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' } } },
      template: enumSchema(templateNames),
      data: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: false, required: fields, properties: {
        date: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 }, category: stringSchema(100), label: stringSchema(160), value: { type: 'number' }, status: stringSchema(40)
      } } },
      components: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['id', 'type', 'title'], properties: componentProperties,
        if: { properties: { type: { const: 'workflow' } }, required: ['type'] },
        then: { required: ['phases'] }, else: { not: { required: ['phases'] } }
      } }
    }
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  function record(value, allowed, required, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(path + ' must be a plain object');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowed.includes(key) || !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(path + ': unknown or unsafe property ' + String(key));
    }
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(path + '.' + key + ' is required');
  }
  function str(value, max, path) {
    if (typeof value !== 'string' || value.length > max) throw new Error(path + ' must be a string of at most ' + max + ' characters');
  }
  function choice(value, values, path) {
    if (!values.includes(value)) throw new Error(path + ' is not an allowed value');
  }
  function array(value, max, path, min = 0) {
    if (!Array.isArray(value) || value.length > max || value.length < min) throw new Error(path + ' has an invalid item count');
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error(path + ' cannot contain sparse items or accessors');
    }
    if (Reflect.ownKeys(value).some(k => k !== 'length' && !(typeof k === 'string' && /^(0|[1-9]\d*)$/.test(k) && Number(k) < value.length))) throw new Error(path + ' has unsafe properties');
  }
  function bytes(text) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : unescape(encodeURIComponent(text)).length; }
  function validate(config) {
    record(config, Object.keys(schema.properties), schema.required, 'config');
    if (config.version !== 1) throw new Error('Unsupported dashboard version');
    str(config.title, 100, 'title'); str(config.description, 800, 'description');
    record(config.theme, ['dark', 'accent'], ['dark', 'accent'], 'theme');
    if (typeof config.theme.dark !== 'boolean' || typeof config.theme.accent !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(config.theme.accent)) throw new Error('Invalid theme');
    choice(config.template, templateNames, 'template');
    array(config.data, 200, 'data');
    for (const row of config.data) {
      record(row, fields, fields, 'data row');
      str(row.date, 10, 'date'); str(row.category, 100, 'category'); str(row.label, 160, 'label'); str(row.status, 40, 'status');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date + 'T00:00:00Z')) || new Date(row.date + 'T00:00:00Z').toISOString().slice(0, 10) !== row.date) throw new Error('Invalid calendar date');
      if (typeof row.value !== 'number' || !Number.isFinite(row.value)) throw new Error('value must be a finite number');
    }
    array(config.components, 16, 'components');
    const ids = new Set();
    for (const c of config.components) {
      record(c, Object.keys(componentProperties), ['id', 'type', 'title'], 'component');
      if (typeof c.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(c.id) || ids.has(c.id)) throw new Error('Component IDs must be safe and unique');
      ids.add(c.id); choice(c.type, types, 'type'); str(c.title, 100, 'component title');
      for (const key of ['field', 'aggregation', 'chartType', 'groupBy']) if (c[key] !== undefined) choice(c[key], componentProperties[key].enum, key);
      for (const key of ['span', 'pageSize']) if (Object.prototype.hasOwnProperty.call(c, key) && (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > (key === 'span' ? 12 : 50))) throw new Error('Invalid ' + key);
      for (const key of ['columns', 'fields']) if (Object.prototype.hasOwnProperty.call(c, key)) {
        array(c[key], key === 'columns' ? 5 : 4, key, 1);
        if (new Set(c[key]).size !== c[key].length) throw new Error('Duplicate ' + key);
        c[key].forEach(v => choice(v, componentProperties[key].items.enum, key));
      }
      if (c.type === 'workflow') {
        array(c.phases, 6, 'phases', 1);
        const workflowIds = new Set();
        function workflowId(id) {
          if (typeof id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(id) || workflowIds.has(id)) throw new Error('Workflow phase and item IDs must be safe and unique within the workflow');
          workflowIds.add(id);
        }
        for (const phase of c.phases) {
          record(phase, ['id', 'title', 'description', 'items'], ['id', 'title', 'description', 'items'], 'phase');
          workflowId(phase.id); str(phase.title, 100, 'phase title'); str(phase.description, 500, 'phase description');
          array(phase.items, 12, 'phase items', 1);
          for (const item of phase.items) {
            record(item, ['id', 'label', 'checked', 'detail'], ['id', 'label'], 'workflow item');
            workflowId(item.id); str(item.label, 300, 'item label');
            if (Object.prototype.hasOwnProperty.call(item, 'checked') && typeof item.checked !== 'boolean') throw new Error('item checked must be a boolean');
            if (Object.prototype.hasOwnProperty.call(item, 'detail')) str(item.detail, 500, 'item detail');
          }
        }
      } else if (Object.prototype.hasOwnProperty.call(c, 'phases')) throw new Error('phases is only allowed for workflow components');
      if (Object.prototype.hasOwnProperty.call(c, 'content')) str(c.content, 1000, 'content');
      for (const key of Object.keys(c)) if (c[key] === undefined) throw new Error('Undefined component property ' + key);
    }
    if (bytes(JSON.stringify(config)) > 120000) throw new Error('Dashboard config exceeds 120KB');
    const result = clone(config);
    result.theme.accent = result.theme.accent.toUpperCase();
    for (const c of result.components) {
      if (c.span === undefined) c.span = c.type === 'metric' ? 4 : c.type === 'chart' ? 6 : 12;
      if (c.type === 'metric' || c.type === 'chart') { if (c.field === undefined) c.field = 'value'; if (c.aggregation === undefined) c.aggregation = 'sum'; }
      if (c.type === 'chart') { if (c.chartType === undefined) c.chartType = 'bar'; if (c.groupBy === undefined) c.groupBy = 'category'; }
      if (c.type === 'table') { if (c.columns === undefined) c.columns = fields.slice(); if (c.pageSize === undefined) c.pageSize = 8; }
      if (c.type === 'filters' && c.fields === undefined) c.fields = ['date', 'category', 'status', 'label'];
      if (c.type === 'text' && c.content === undefined) c.content = '';
      if (c.type === 'workflow') for (const phase of c.phases) for (const item of phase.items) if (item.checked === undefined) item.checked = false;
    }
    if (bytes(JSON.stringify(result)) > 120000) throw new Error('Dashboard config exceeds 120KB');
    return result;
  }
  const registry = {
    metric: { description: 'KPI computed from the shared filtered dataset. sum/avg use numeric values; count counts records/nonempty fields.', options: ['field', 'aggregation', 'span'] },
    filters: { description: 'Shared date range, category/status selection and case-insensitive search. All filter panels stay synchronized.', options: ['fields', 'span'] },
    chart: { description: 'Accessible SVG bar, line or donut grouped by category/date/status. Donuts show absolute magnitudes; large group sets combine the tail as Other.', options: ['field', 'aggregation', 'chartType', 'groupBy', 'span'] },
    table: { description: 'Sortable columns and paginated records from the shared filtered dataset.', options: ['columns', 'pageSize', 'span'] },
    text: { description: 'Escaped plain-text explanation, never HTML or executable code.', options: ['content', 'span'] },
    board: { description: 'Shared data records grouped by status into lanes showing label, category, date and value. Use workflow instead for authored educational/project phases and checklists. No drag-and-drop or remote writes.', options: ['span'] },
    workflow: { description: 'Authored educational/project steps, independent of shared data and filters, not a status board. phases: [{id,title,description,items:[{id,label,checked,detail?}]}]. Required phases: 1..6, items per phase: 1..12. Required safe IDs match ^[a-zA-Z][a-zA-Z0-9_-]{0,39}$ and are unique across all phases AND items within each workflow. title <=100, description <=500, label <=300, optional detail <=500 characters; checked is an optional boolean defaulting to false. Text is plain text only. Each item has an independent checkbox with phase and overall progress. Checks live only in mounted preview memory, survive redraws/record edits and reset on reload; never mutate config, draft, backend or browser storage. phases is forbidden on all other component types.', options: ['phases', 'span'] },
    insights: { description: 'Exact summaries computed from filtered records: count, total, average, range, dates and category/status distributions. Never invented findings.', options: ['span'] },
    form: { description: 'Validated add/edit/delete editor for all five shared row fields in synthetic session memory only. Updates every view and filter option, never the original config or a backend. At most 200 rows and 120KB.', options: ['span'] }
  };
  function base(name) {
    const settings = {
      sales: { title: 'Sales overview', categories: ['Direct', 'Partners', 'Online'], statuses: ['Won', 'Pending', 'Lost'], labels: ['Enterprise plan', 'Team plan', 'Renewal'], metric: 'Revenue', unit: 1250 },
      operations: { title: 'Operations overview', categories: ['Support', 'Logistics', 'Service'], statuses: ['Completed', 'In progress', 'Blocked'], labels: ['Request', 'Delivery', 'Service task'], metric: 'Workload', unit: 8 },
      projects: { title: 'Project portfolio', categories: ['Product', 'Platform', 'Design'], statuses: ['Completed', 'In progress', 'Planned'], labels: ['Milestone', 'Sprint', 'Initiative'], metric: 'Planned effort', unit: 12 }
    }[name];
    return validate({ version: 1, title: settings.title, description: 'Synthetic demonstration data · not connected to a live source.', theme: { dark: false, accent: '#FEFF44' }, template: name,
      data: Array.from({ length: 36 }, (_, i) => ({ date: '2026-' + String(1 + Math.floor(i / 12)).padStart(2, '0') + '-' + String(1 + i % 12).padStart(2, '0'), category: settings.categories[i % 3], label: settings.labels[i % 3] + ' ' + (i + 1), value: settings.unit * (1 + i % 7), status: settings.statuses[(i + Math.floor(i / 3)) % 3] })),
      components: [
        { id: 'total', type: 'metric', title: settings.metric, aggregation: 'sum', field: 'value', span: 4 },
        { id: 'average', type: 'metric', title: 'Average value', aggregation: 'avg', span: 4 },
        { id: 'records', type: 'metric', title: 'Records', aggregation: 'count', span: 4 },
        { id: 'filters', type: 'filters', title: 'Explore data', span: 12 },
        { id: 'breakdown', type: 'chart', title: 'By category', chartType: 'bar', groupBy: 'category', span: 6 },
        { id: 'trend', type: 'chart', title: 'Trend over time', chartType: 'line', groupBy: 'date', span: 6 },
        { id: 'details', type: 'table', title: 'Records', pageSize: 8, span: 12 }
      ] });
  }
  const templates = Object.fromEntries(templateNames.map(name => [name, base(name)]));
  function detectTemplate(prompt) {
    if (/\b(sales|ventas|revenue|ingresos|comercial)\b/i.test(prompt)) return 'sales';
    if (/\b(operations|operaciones|logistics|logística|support|soporte)\b/i.test(prompt)) return 'operations';
    if (/\b(projects?|proyectos?|portfolio|portafolio)\b/i.test(prompt)) return 'projects';
    return null;
  }
  function createConfig(prompt, previousConfig = null) {
    str(prompt, 8000, 'prompt');
    const requested = detectTemplate(prompt);
    const config = previousConfig === null ? base(requested || 'sales') : validate(previousConfig);
    if (requested) config.template = requested;
    if (/\b(dark|oscuro|oscura)\b/i.test(prompt)) config.theme.dark = true;
    if (/\b(light|claro|clara)\b/i.test(prompt)) config.theme.dark = false;
    const accent = prompt.match(/#[a-f\d]{6}\b|#[a-f\d]{3}\b/i);
    if (accent) config.theme.accent = accent[0];
    else if (/\b(yellow|amarillo)\b/i.test(prompt)) config.theme.accent = '#FEFF44';
    else if (/\b(blue|azul)\b/i.test(prompt)) config.theme.accent = '#60A5FA';
    else if (/\b(green|verde)\b/i.test(prompt)) config.theme.accent = '#34D399';
    const chartType = /\b(donut|doughnut|anillo|rosquilla)\b/i.test(prompt) ? 'donut' : /\b(line|lines|línea|líneas|linea|lineas)\b/i.test(prompt) ? 'line' : /\b(bar|bars|barras|barra)\b/i.test(prompt) ? 'bar' : null;
    const sentences = prompt.split(/[.;\n]|\b(?:and|y)\b/i);
    const addingChart = sentences.some(sentence => /\b(add|añade|añadir|agrega|agregar)\b/i.test(sentence) && /\b(charts?|gráfic[oa]s?|grafic[oa]s?)\b/i.test(sentence));
    if (chartType && !addingChart) config.components.filter(c => c.type === 'chart').forEach(c => { c.chartType = chartType; });
    for (const sentence of sentences) {
      const remove = /\b(remove|delete|hide|without|quita|quitar|elimina|eliminar|sin)\b/i.test(sentence);
      const append = /\b(add|añade|añadir|agrega|agregar)\b/i.test(sentence);
      const add = append || /\b(include|show|incluye|con)\b/i.test(sentence);
      for (const [type, pattern] of [['chart', /\b(charts?|gráfic[oa]s?|grafic[oa]s?)\b/i], ['filters', /\b(filters?|filtros?)\b/i], ['table', /\b(tables?|tablas?)\b/i]]) {
        if (!pattern.test(sentence)) continue;
        if (remove) config.components = config.components.filter(c => c.type !== type);
        else if (add && (append || !config.components.some(c => c.type === type)) && config.components.length < 16) {
          let id = type, n = 2; while (config.components.some(c => c.id === id)) id = type + n++;
          config.components.push({ id, type, title: type === 'chart' ? chartType === 'line' ? 'Trend over time' : 'Data breakdown' : type === 'filters' ? 'Explore data' : 'Records', ...(type === 'chart' ? { chartType: chartType || 'bar', groupBy: chartType === 'line' ? 'date' : 'category' } : {}) });
        }
      }
    }
    return validate(config);
  }
  function context(prompt, previousConfig = null) {
    str(prompt, 8000, 'prompt');
    const previous = previousConfig === null ? null : validate(previousConfig);
    const name = detectTemplate(prompt) || (previous && previous.template);
    const relevantTypes = new Set(previous ? previous.components.map(c => c.type) : types);
    if (/chart|gráfic|grafic|donut|line|bar/i.test(prompt)) relevantTypes.add('chart');
    if (/filter|filtro/i.test(prompt)) relevantTypes.add('filters');
    if (/table|tabla/i.test(prompt)) relevantTypes.add('table');
    if (/board|kanban|tablero/i.test(prompt)) relevantTypes.add('board');
    if (/workflow|phase|fase|checklist|pasos|fundamentos|primer agente|cowork/i.test(prompt)) { relevantTypes.add('workflow'); relevantTypes.add('board'); }
    if (/form|editor|record|registro/i.test(prompt)) relevantTypes.add('form');
    if (/insight|summary|resumen|análisis/i.test(prompt)) relevantTypes.add('insights');
    return { schema: clone(schema), components: Object.fromEntries([...relevantTypes].map(t => [t, clone(registry[t])])), templates: clone(name ? { [name]: templates[name] } : templates), previousConfig: previous,
      guidance: ['Return only a declarative config; no HTML, JavaScript, URLs, expressions or unknown properties.', 'Shared data drives metrics, charts, tables, boards, insights and filters. Workflow is different: authored educational/project phases with independently checkable steps, unaffected by data filters. Use phases: [{id,title,description,items:[{id,label,checked,detail?}]}], 1..6 phases, 1..12 items each; safe unique IDs across all phases/items in a workflow; title<=100, description<=500, label<=300, detail<=500, checked boolean default false. phases is required only on workflow and forbidden elsewhere. Check state is mounted-preview memory only, resets on reload and never mutates exported config/draft/backend. Samples and form edits are synthetic session data, never real or live. Forms must not alter the original exported config. Insights compute exact dataset facts only.', 'Validate before rendering. IDs must be unique. At most 200 rows, 16 components, 120KB config and 200KB HTML.', 'Deterministic fallback supports template keywords, dark/light, hex or yellow/blue/green accents, chart types, and adding/removing chart/filter/table blocks only. Unsupported requests are not AI-generated; disclose this in the calling Studio UI.', 'On followups preserve existing rows and components unless explicitly changed. A template keyword updates metadata without replacing existing data.', 'Use value with sum/avg; use count for textual fields. Donuts use absolute magnitudes; line charts normally group by date.'] };
  }
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inlineJSON = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  function dashboardRuntime() {
    'use strict';
    const config = JSON.parse(document.getElementById('blk-dashboard-config').textContent);
    const filters = { start: '', end: '', category: '', status: '', search: '' };
    function readState(key, fallback) {
      try { const stored = localStorage.getItem('tektonik-dashboard:' + key); return stored === null ? fallback : JSON.parse(stored); }
      catch { return fallback; }
    }
    function persist(key, value) {
      try { localStorage.setItem('tektonik-dashboard:' + key, JSON.stringify(value)); return ''; }
      catch { return 'No se han guardado los cambios. Exporta los datos antes de recargar.'; }
    }
    const savedRows = readState('records', null);
    const validRows = Array.isArray(savedRows) && savedRows.length <= 200 && savedRows.every(row => row && ['date', 'category', 'label', 'status'].every(key => typeof row[key] === 'string' && row[key].length <= 500) && typeof row.value === 'number' && Number.isFinite(row.value));
    const sessionRows = (validRows ? savedRows : config.data).map(row => ({ ...row }));
    const panels = [], views = [], forms = [], states = new Map();
    const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
    const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; };
    const svg = (tag, attrs, text) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v))); if (text !== undefined) node.textContent = String(text); return node; };
    const aggregate = (rows, c) => {
      if (c.aggregation === 'count') return rows.filter(r => r[c.field] !== '').length;
      const values = rows.map(r => r[c.field]).filter(v => typeof v === 'number');
      if (!values.length) return 0;
      const scale = Math.max(...values.map(Math.abs));
      if (!scale) return 0;
      const total = values.reduce((sum, value) => sum + value / scale, 0) / (c.aggregation === 'avg' ? values.length : 1);
      return Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, total * scale));
    };
    const filtered = () => sessionRows.filter(row => (!filters.start || row.date >= filters.start) && (!filters.end || row.date <= filters.end) && (!filters.category || row.category === filters.category) && (!filters.status || row.status === filters.status) && (!filters.search || [row.label, row.category, row.status, row.date].some(v => v.toLocaleLowerCase().includes(filters.search.toLocaleLowerCase()))));
    function button(text, handler) { const node = el('button', text); node.type = 'button'; node.addEventListener('click', handler); return node; }
    function updateFilters() {
      for (const key of ['category', 'status']) if (filters[key] && !sessionRows.some(row => row[key] === filters[key])) filters[key] = '';
      for (const { input, key } of panels) {
        if (input.tagName === 'SELECT') {
          input.replaceChildren(); const all = el('option', 'All'); all.value = ''; input.appendChild(all);
          [...new Set(sessionRows.map(row => row[key]))].sort().forEach(value => { if (value !== '') { const option = el('option', value); option.value = value; input.appendChild(option); } });
        }
        input.value = filters[key];
      }
    }
    function filterPanel(c, target) {
      const controls = el('div', undefined, 'filter-controls');
      function control(key, caption, kind, options) {
        const label = el('label', caption), input = el(options ? 'select' : 'input');
        input.id = 'control-' + c.id + '-' + key;
        input.setAttribute('data-filter', key);
        if (options) {
          const all = el('option', 'All'); all.value = ''; input.appendChild(all);
          options.forEach(value => { const option = el('option', value); option.value = value; input.appendChild(option); });
        } else input.type = kind;
        input.addEventListener(options ? 'change' : 'input', () => { filters[key] = input.value; states.forEach(state => { state.page = 1; }); updateFilters(); refresh(); });
        label.appendChild(input); controls.appendChild(label); panels.push({ input, key });
      }
      for (const field of c.fields) {
        if (field === 'date') { control('start', 'From date', 'date'); control('end', 'To date', 'date'); }
        else if (field === 'label') control('search', 'Search records', 'search');
        else control(field, field === 'category' ? 'Category' : 'Status', null, [...new Set(sessionRows.map(row => row[field]))].sort());
      }
      controls.appendChild(button('Reset filters', () => { Object.keys(filters).forEach(k => { filters[k] = ''; }); states.forEach(state => { state.page = 1; }); updateFilters(); refresh(); }));
      target.appendChild(controls);
    }
    function table(c, target, rows) {
      const state = states.get(c.id);
      const sorted = rows.slice().sort((a, b) => {
        if (!state.sort) return 0;
        const x = a[state.sort], y = b[state.sort];
        return (typeof x === 'number' ? (x < y ? -1 : x > y ? 1 : 0) : String(x).localeCompare(String(y))) * state.direction;
      });
      const pages = Math.max(1, Math.ceil(sorted.length / c.pageSize)); state.page = Math.min(state.page, pages);
      const scroller = el('div', undefined, 'table-scroll'), grid = el('table'), caption = el('caption', c.title + ' · ' + rows.length + ' records'), head = el('thead'), tr = el('tr');
      grid.appendChild(caption);
      c.columns.forEach(field => {
        const th = el('th'); th.scope = 'col'; th.setAttribute('aria-sort', state.sort === field ? state.direction === 1 ? 'ascending' : 'descending' : 'none');
        const sortButton = button(field + (state.sort === field ? state.direction === 1 ? ' ↑' : ' ↓' : ' ↕'), () => {
          state.direction = state.sort === field ? -state.direction : 1; state.sort = field; state.page = 1; refresh();
          const active = target.querySelector('[data-sort="' + field + '"]'); if (active) active.focus();
        });
        sortButton.setAttribute('data-sort', field); sortButton.setAttribute('aria-label', 'Sort by ' + field); th.appendChild(sortButton); tr.appendChild(th);
      });
      head.appendChild(tr); grid.appendChild(head);
      const body = el('tbody');
      sorted.slice((state.page - 1) * c.pageSize, state.page * c.pageSize).forEach(row => { const line = el('tr'); c.columns.forEach(field => { const cell = el('td'); cell.appendChild(field === 'status' ? statusBadge(row[field]) : el('span', field === 'value' ? number.format(row[field]) : row[field])); line.appendChild(cell); }); body.appendChild(line); });
      if (!rows.length) { const line = el('tr'), cell = el('td', 'No records match these filters.'); cell.colSpan = c.columns.length; line.appendChild(cell); body.appendChild(line); }
      grid.appendChild(body); scroller.appendChild(grid); target.appendChild(scroller);
      const nav = el('div', undefined, 'pagination'); nav.setAttribute('aria-label', c.title + ' pagination');
      const prev = button('Previous', () => { state.page--; refresh(); const focus = target.querySelector('[data-page="previous"]'); if (focus) focus.focus(); }); prev.disabled = state.page === 1; prev.setAttribute('data-page', 'previous');
      const next = button('Next', () => { state.page++; refresh(); const focus = target.querySelector('[data-page="next"]'); if (focus) focus.focus(); }); next.disabled = state.page === pages; next.setAttribute('data-page', 'next');
      nav.appendChild(prev); nav.appendChild(el('span', 'Page ' + state.page + ' of ' + pages + ' · ' + rows.length + ' records')); nav.appendChild(next); target.appendChild(nav);
    }
    function chart(c, target, rows) {
      if (!rows.length) { target.appendChild(el('p', 'No records match these filters.', 'empty-state')); return; }
      const grouped = new Map(); rows.forEach(row => { const key = row[c.groupBy]; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row); });
      let entries = [...grouped].sort(([a], [b]) => a.localeCompare(b));
      if (entries.length > 18) entries = entries.slice(0, 17).concat([['Other (remaining groups)', entries.slice(17).flatMap(entry => entry[1])]]);
      const points = entries.map(([label, items]) => ({ label, value: aggregate(items, c) }));
      const root = svg('svg', { viewBox: '0 0 600 280', role: 'img', 'aria-label': c.title + ' — ' + c.chartType + ' chart', preserveAspectRatio: 'xMidYMid meet' });
      root.appendChild(svg('title', {}, c.title)); root.appendChild(svg('desc', {}, points.map(p => p.label + ': ' + number.format(p.value)).join('; ')));
      const max = Math.max(0, ...points.map(p => p.value)), min = Math.min(0, ...points.map(p => p.value));
      const scale = Math.max(Math.abs(max), Math.abs(min), 1), range = max / scale - min / scale || 1;
      const y = value => 225 - ((value / scale - min / scale) / range) * 195;
      if (c.chartType === 'donut') {
        const magnitude = Math.max(...points.map(p => Math.abs(p.value)), 1), total = points.reduce((sum, p) => sum + Math.abs(p.value) / magnitude, 0);
        let offset = 0;
        points.forEach((p, i) => { const fraction = total ? Math.abs(p.value) / magnitude / total : 0;
          const circle = svg('circle', { cx: 300, cy: 132, r: 88, fill: 'none', stroke: i === 0 ? 'var(--chart-accent)' : 'hsl(' + ((i * 47 + 195) % 360) + ' 62% 48%)', 'stroke-width': 34, pathLength: 100, 'stroke-dasharray': fraction * 100 + ' ' + (100 - fraction * 100), 'stroke-dashoffset': -offset * 100, transform: 'rotate(-90 300 132)' });
          circle.appendChild(svg('title', {}, p.label + ': ' + number.format(p.value))); root.appendChild(circle); offset += fraction;
        });
        root.appendChild(svg('text', { x: 300, y: 137, 'text-anchor': 'middle', fill: 'var(--fg)', 'font-size': 18 }, total ? 'Distribution' : 'No value'));
      } else {
        root.appendChild(svg('line', { x1: 35, y1: y(0), x2: 580, y2: y(0), stroke: 'var(--line)' }));
        const step = 540 / points.length;
        if (c.chartType === 'line') root.appendChild(svg('polyline', { points: points.map((p, i) => (45 + (i + 0.5) * step) + ',' + y(p.value)).join(' '), fill: 'none', stroke: 'var(--chart-accent)', 'stroke-width': 3 }));
        points.forEach((p, i) => {
          const x = 45 + (i + 0.5) * step;
          const shape = c.chartType === 'bar' ? svg('rect', { x: x - step * 0.33, y: Math.min(y(p.value), y(0)), width: step * 0.66, height: Math.max(1, Math.abs(y(p.value) - y(0))), rx: 3, fill: 'var(--chart-accent)' }) : svg('circle', { cx: x, cy: y(p.value), r: 4, fill: 'var(--chart-accent)' });
          shape.appendChild(svg('title', {}, p.label + ': ' + number.format(p.value))); root.appendChild(shape);
          root.appendChild(svg('text', { x, y: 247, 'text-anchor': 'middle', fill: 'var(--fg-soft)', 'font-size': 10 }, p.label.length > 13 ? p.label.slice(0, 12) + '…' : p.label));
        });
      }
      target.appendChild(root);
      const legend = el('ul', undefined, 'chart-legend'); points.forEach(p => legend.appendChild(el('li', p.label + ': ' + number.format(p.value)))); target.appendChild(legend);
      if (c.chartType === 'donut') target.appendChild(el('p', 'Segments represent absolute magnitudes.', 'chart-note'));
    }
    function statusBadge(status) { return el('span', status || 'No status', 'status-pill'); }
    function board(c, target, rows) {
      if (!rows.length) { target.appendChild(el('p', 'No records match these filters.', 'empty-state')); return; }
      const lanes = el('div', undefined, 'board-lanes');
      [...new Set(rows.map(row => row.status))].sort().forEach(status => {
        const items = rows.filter(row => row.status === status), lane = el('section', undefined, 'board-lane');
        const heading = el('h3', undefined, 'lane-heading'); heading.appendChild(statusBadge(status)); heading.appendChild(el('span', items.length, 'lane-count')); lane.appendChild(heading);
        items.forEach(row => {
          const card = el('article', undefined, 'record-card'); card.appendChild(el('p', row.category || 'Uncategorized', 'record-category'));
          card.appendChild(el('h4', row.label || 'Untitled record')); const meta = el('div', undefined, 'record-meta');
          meta.appendChild(el('time', row.date)); meta.appendChild(el('strong', number.format(row.value))); card.appendChild(meta); lane.appendChild(card);
        }); lanes.appendChild(lane);
      }); target.appendChild(lanes);
    }
    function workflow(c, target) {
      const saved = readState('workflow:' + c.id, {});
      const checked = new Map(c.phases.flatMap(phase => phase.items.map(item => [item.id, saved && typeof saved[item.id] === 'boolean' ? saved[item.id] : item.checked])));
      const notice = el('p', 'Marca cada paso de forma independiente. El progreso se conserva mediante el almacenamiento de la aplicación.', 'session-notice');
      target.appendChild(notice);
      function progress(parent, key, caption, items, live) {
        const summary = el('div', undefined, 'workflow-summary'), count = el('p', '', 'workflow-count'), bar = el('progress');
        count.setAttribute('data-workflow-count', key);
        if (live) { count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite'); }
        bar.max = items.length; bar.setAttribute('aria-label', caption); bar.setAttribute('data-workflow-progress', key);
        summary.appendChild(count); summary.appendChild(bar); parent.appendChild(summary);
        return () => {
          const done = items.filter(item => checked.get(item.id)).length;
          count.textContent = done + ' / ' + items.length + ' completed · ' + Math.round(done / items.length * 100) + '%';
          bar.value = done;
        };
      }
      const updateOverall = progress(target, 'overall', c.title + ' overall progress', c.phases.flatMap(phase => phase.items), true);
      const phases = el('ol', undefined, 'workflow-phases');
      c.phases.forEach((phase, index) => {
        const node = el('li', undefined, 'workflow-phase'), heading = el('h3', phase.title), header = el('div', undefined, 'workflow-phase-header');
        node.setAttribute('data-workflow-phase', phase.id); heading.id = 'workflow:' + c.id + ':' + phase.id;
        node.setAttribute('aria-labelledby', heading.id);
        header.appendChild(el('span', String(index + 1).padStart(2, '0'), 'workflow-step')); header.appendChild(heading); node.appendChild(header);
        node.appendChild(el('p', phase.description, 'workflow-purpose'));
        const updatePhase = progress(node, 'phase:' + phase.id, phase.title + ' progress', phase.items, false), items = el('ul', undefined, 'workflow-items');
        phase.items.forEach(item => {
          const line = el('li'), label = el('label', undefined, 'workflow-item'), input = el('input'), text = el('span');
          input.type = 'checkbox'; input.checked = checked.get(item.id); input.setAttribute('data-workflow-item', item.id);
          text.appendChild(el('span', item.label, 'workflow-label'));
          if (item.detail !== undefined) {
            const detail = el('span', item.detail, 'workflow-detail'); detail.id = 'workflow:' + c.id + ':' + item.id;
            input.setAttribute('aria-describedby', detail.id); text.appendChild(detail);
          }
          input.addEventListener('change', () => { checked.set(item.id, input.checked); const error = persist('workflow:' + c.id, Object.fromEntries(checked)); if (error) notice.textContent = error; updatePhase(); updateOverall(); });
          label.appendChild(input); label.appendChild(text); line.appendChild(label); items.appendChild(line);
        });
        node.appendChild(items); phases.appendChild(node); updatePhase();
      });
      target.appendChild(phases); updateOverall();
    }
    function insights(c, target, rows) {
      target.appendChild(el('p', 'Calculated from the current filtered records. No predictions or external facts.', 'chart-note'));
      if (!rows.length) { target.appendChild(el('p', 'No records match these filters.', 'empty-state')); return; }
      const values = rows.map(row => row.value), dates = rows.map(row => row.date).sort(), summary = el('dl', undefined, 'insight-grid');
      const facts = [['Records', String(rows.length)], ['Total value', number.format(aggregate(rows, { field: 'value', aggregation: 'sum' }))], ['Average value', number.format(aggregate(rows, { field: 'value', aggregation: 'avg' }))], ['Value range', number.format(Math.min(...values)) + ' – ' + number.format(Math.max(...values))], ['Date range', dates[0] + ' – ' + dates[dates.length - 1]]];
      facts.forEach(([label, value]) => { const fact = el('div'); fact.appendChild(el('dt', label)); fact.appendChild(el('dd', value)); summary.appendChild(fact); }); target.appendChild(summary);
      for (const field of ['category', 'status']) {
        target.appendChild(el('h3', field === 'category' ? 'Category breakdown' : 'Status breakdown', 'insight-heading'));
        const list = el('ul', undefined, 'insight-breakdown');
        [...new Set(rows.map(row => row[field]))].sort().forEach(value => { const items = rows.filter(row => row[field] === value), line = el('li');
          line.appendChild(el('span', value || '(empty)')); line.appendChild(el('strong', items.length + ' records · ' + number.format(aggregate(items, { field: 'value', aggregation: 'sum' })) + ' total')); list.appendChild(line);
        }); target.appendChild(list);
      }
    }
    function recordForm(c, target) {
      target.appendChild(el('p', 'Record editor · Changes are stored separately from the original application. Export your data to keep a copy.', 'session-notice'));
      const form = el('form'), controls = el('div', undefined, 'record-fields'), inputs = {};
      form.noValidate = true; form.setAttribute('data-record-form', c.id);
      const selectLabel = el('label', 'Choose a filtered record to edit'), select = el('select'); select.setAttribute('data-record-select', c.id); selectLabel.appendChild(select); form.appendChild(selectLabel);
      const message = el('p', '', 'form-message'); message.id = 'message-' + c.id; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
      const editor = { select, inputs, selected: null, message };
      for (const field of ['date', 'category', 'label', 'value', 'status']) {
        const label = el('label', field.charAt(0).toUpperCase() + field.slice(1)), input = el('input'); input.name = field; input.setAttribute('data-record-field', field);
        input.type = field === 'date' ? 'date' : field === 'value' ? 'number' : 'text'; input.required = true;
        if (field === 'value') input.step = 'any'; else if (field !== 'date') input.maxLength = field === 'label' ? 160 : field === 'category' ? 100 : 40;
        input.setAttribute('aria-describedby', message.id); inputs[field] = input; label.appendChild(input); controls.appendChild(label);
      }
      function reset() { editor.selected = null; select.value = ''; Object.values(inputs).forEach(input => { input.value = ''; }); save.textContent = 'Add record'; remove.disabled = true; }
      select.addEventListener('change', () => {
        const row = select.value === '' ? null : sessionRows[Number(select.value)];
        if (!row) { reset(); return; } editor.selected = row;
        Object.keys(inputs).forEach(field => { inputs[field].value = String(row[field]); }); save.textContent = 'Save changes'; remove.disabled = false; message.textContent = '';
      });
      const actions = el('div', undefined, 'form-actions'), save = el('button', 'Add record', 'primary-button'); save.type = 'submit';
      const remove = button('Delete record', () => {
        const index = sessionRows.indexOf(editor.selected); if (index < 0) return;
        sessionRows.splice(index, 1); reset(); changed('Record deleted.');
      }); remove.setAttribute('data-record-delete', c.id); remove.disabled = true;
      actions.appendChild(save); actions.appendChild(button('New record', () => { reset(); message.textContent = ''; })); actions.appendChild(remove);
      function changed(text) { const error = persist('records', sessionRows); states.forEach(state => { state.page = 1; }); refresh(); message.textContent = text + (error ? ' ' + error : ''); }
      form.addEventListener('submit', event => {
        event.preventDefault();
        const row = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
        const fail = text => { message.textContent = text; };
        if (Object.values(row).some(value => !value)) return fail('All five fields are required.');
        if (row.category.length > 100 || row.label.length > 160 || row.status.length > 40) return fail('Category: maximum 100 characters; label: 160; status: 40.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date + 'T00:00:00Z')) || new Date(row.date + 'T00:00:00Z').toISOString().slice(0, 10) !== row.date) return fail('Enter a valid calendar date.');
        row.value = Number(row.value); if (!Number.isFinite(row.value)) return fail('Value must be a finite number.');
        const index = sessionRows.indexOf(editor.selected);
        if (index < 0 && sessionRows.length >= 200) return fail('Storage limit: 200 records. Delete a record before adding another.');
        const candidate = sessionRows.slice(); if (index < 0) candidate.push(row); else candidate[index] = row;
        if (new TextEncoder().encode(JSON.stringify({ ...config, data: candidate })).length > 120000) return fail('Records exceed the 120KB configuration limit.');
        if (index < 0) sessionRows.push(row); else sessionRows[index] = row;
        reset(); changed(index < 0 ? 'Record added.' : 'Record updated.');
      });
      form.appendChild(controls); form.appendChild(actions); form.appendChild(message); target.appendChild(form);
      editor.reset = reset; editor.remove = remove; forms.push(editor);
    }
    function refresh() {
      updateFilters();
      const rows = filtered();
      document.getElementById('dashboard-status').textContent = rows.length + ' of ' + sessionRows.length + ' records';
      for (const editor of forms) {
        if (editor.selected && !sessionRows.includes(editor.selected)) editor.reset();
        const fresh = el('option', 'New record'); fresh.value = ''; editor.select.replaceChildren(fresh);
        rows.forEach(row => { const option = el('option', row.label + ' · ' + row.date + ' · ' + row.status); option.value = String(sessionRows.indexOf(row)); editor.select.appendChild(option); });
        const index = sessionRows.indexOf(editor.selected); editor.select.value = index >= 0 && rows.includes(editor.selected) ? String(index) : '';
        if (editor.selected && !rows.includes(editor.selected)) editor.reset();
      }
      for (const { c, target } of views) {
        target.replaceChildren();
        if (c.type === 'metric') { const value = el('p', number.format(aggregate(rows, c)), 'metric-value'); value.setAttribute('data-metric-value', c.id); target.appendChild(value); target.appendChild(el('span', rows.length ? c.aggregation + ' · ' + c.field : 'No matching records', 'metric-note')); }
        else if (c.type === 'table') table(c, target, rows);
        else if (c.type === 'chart') chart(c, target, rows);
        else if (c.type === 'board') board(c, target, rows);
        else if (c.type === 'insights') insights(c, target, rows);
      }
    }
    for (const c of config.components) {
      const target = document.querySelector('[data-component-id="' + c.id + '"] .component-body');
      if (c.type === 'filters') filterPanel(c, target);
      else if (c.type === 'text') target.appendChild(el('p', c.content, 'plain-text'));
      else if (c.type === 'form') recordForm(c, target);
      else if (c.type === 'workflow') workflow(c, target);
      else { views.push({ c, target }); if (c.type === 'table') states.set(c.id, { page: 1, sort: null, direction: 1 }); }
    }
    refresh();
  }
  function renderHTML(input) {
    const config = validate(input);
    const accent = config.theme.accent.length === 4 ? '#' + [...config.theme.accent.slice(1)].map(c => c + c).join('') : config.theme.accent;
    const rgb = [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16));
    const accentOn = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 155 ? '#111111' : '#FFFFFF';
    const first = {};
    const cards = config.components.map(c => {
      let id = ''; if (!first[c.type]) { first[c.type] = true; if (['filters', 'table'].includes(c.type)) id = ' id="dashboard-' + c.type + '"'; }
      return '<section' + id + ' class="dashboard-card" style="--span:' + c.span + '" data-component-id="' + c.id + '" data-component-type="' + c.type + '" aria-labelledby="heading-' + c.id + '"><h2 id="heading-' + c.id + '">' + escapeHTML(c.title) + '</h2><div class="component-body"></div></section>';
    });
    const navigation = '<nav class="section-nav" aria-label="Application sections">' + config.components.map(c => '<a href="#heading-' + c.id + '">' + escapeHTML(c.title) + '</a>').join('') + '</nav>';
    const metricCards = config.components.map((c, i) => c.type === 'metric' ? cards[i] : '').join('');
    const otherCards = config.components.map((c, i) => c.type !== 'metric' ? cards[i] : '').join('');
    const html = '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; form-action \'none\'; base-uri \'none\'; object-src \'none\'; frame-src \'none\'; img-src \'none\'; font-src \'none\'"><title>' + escapeHTML(config.title) + '</title><style>\n' +
      ':root{--bg:#EFEFEB;--bg-2:#E4E4DF;--card:#FFFFFF;--fg:#111111;--fg-soft:#444444;--muted:#777777;--line:#E2E2DE;--accent:' + accent + ';--accent-on:' + accentOn + ';--chart-accent:#0B7A48;--green:#0B7A48;--green-bg:#E8F5EE;--amber:#B45309;--amber-bg:#FEF3C7;--red:#B91C1C;--red-bg:#FEE2E2;--blue:#1D4ED8;--blue-bg:#EFF6FF;--display-font:system-ui,-apple-system,Barlow,sans-serif;--body-font:system-ui,-apple-system,"DM Sans",sans-serif;--mono-font:ui-monospace,"JetBrains Mono",monospace;--r-card:16px;--r-sm:8px;--sidebar-w:260px;--topbar-h:60px;--shadow:0 8px 24px -10px rgba(0,0,0,.08);--shadow-lg:0 20px 40px rgba(0,0,0,.16)}' +
      (config.theme.dark ? ':root{--bg:#171816;--bg-2:#282A25;--card:#21231F;--fg:#F4F4EE;--fg-soft:#C9CCC2;--muted:#A0A598;--line:#3C4036;--chart-accent:var(--accent)}' : '') +
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--body-font);line-height:1.5}.top-bar{height:var(--topbar-h);border-bottom:1px solid var(--line);padding:0 28px;display:flex;align-items:center;gap:12px;background:var(--card)}.brand-logo{background:#111;color:var(--accent);border-radius:8px;width:36px;height:36px;display:grid;place-items:center;font:900 15px var(--display-font)}.badge{background:var(--accent);color:var(--accent-on);padding:3px 8px;border-radius:4px;font:700 10px var(--mono-font);letter-spacing:.05em}main{max-width:1440px;margin:auto;padding:28px 36px 60px}h1{font:800 clamp(26px,4vw,40px) var(--display-font);margin:8px 0}h2{font:700 16px var(--display-font);margin:0 0 16px}p{margin:8px 0}.description{color:var(--fg-soft);max-width:900px;white-space:pre-wrap}.status{font:12px var(--mono-font);color:var(--fg-soft);margin:20px 0}.dashboard-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px}#dashboard-metrics{display:contents}.dashboard-card{grid-column:span var(--span);min-width:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);padding:22px;box-shadow:var(--shadow)}.metric-value{font:800 36px var(--display-font);overflow-wrap:anywhere}.metric-note,.chart-note{font-size:12px;color:var(--fg-soft)}.filter-controls{display:flex;align-items:end;flex-wrap:wrap;gap:14px}label{display:flex;flex-direction:column;gap:6px;flex:1 1 150px;font-size:12px;font-weight:700}input,select,button{font:inherit;color:var(--fg);border:1px solid var(--line);border-radius:var(--r-sm);padding:9px 11px;background:var(--bg);min-height:40px;max-width:100%}button{cursor:pointer;font-weight:700}button:hover:not(:disabled){border-color:var(--fg)}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--blue);outline-offset:3px}input,select{width:100%;color-scheme:' + (config.theme.dark ? 'dark' : 'light') + '}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;text-align:left}caption{text-align:left;color:var(--fg-soft);padding-bottom:10px}th,td{padding:12px 10px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th button{border:0;background:transparent;padding:4px 0;min-height:32px}td{max-width:260px}.pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:16px;font-size:12px}.component-body svg{display:block;width:100%;height:auto}.chart-legend{display:flex;flex-wrap:wrap;gap:6px 16px;list-style:none;padding:0;font:11px var(--mono-font);color:var(--fg-soft);overflow-wrap:anywhere}.plain-text{white-space:pre-wrap;overflow-wrap:anywhere}.empty-state{text-align:center;padding:30px 10px;color:var(--fg-soft)}footer{font:11px var(--mono-font);color:var(--fg-soft);margin-top:24px}@media(max-width:900px){.dashboard-card{grid-column:span 6}.dashboard-card[data-component-type="filters"],.dashboard-card[data-component-type="table"],.dashboard-card[data-component-type="text"]{grid-column:span 12}main{padding:24px}}@media(max-width:600px){main{padding:20px 14px 40px}.top-bar{padding:0 14px}.dashboard-grid{gap:14px}.dashboard-card{grid-column:span 12;padding:18px}.pagination{flex-wrap:wrap}.metric-value{font-size:32px}}' +
      '.hero{padding:32px clamp(20px,4vw,48px);margin-bottom:20px;border:1px solid var(--line);border-radius:24px;background:radial-gradient(ellipse at top right,var(--bg-2),transparent 70%),var(--card);box-shadow:var(--shadow)}.hero h1{font-size:clamp(30px,5vw,56px);letter-spacing:-.055em;line-height:1.08;overflow-wrap:anywhere}.hero .status{margin-bottom:0}.eyebrow{font:700 10px var(--mono-font);letter-spacing:.15em;color:var(--fg-soft)}.section-nav{display:flex;gap:8px;overflow-x:auto;padding:4px 0 20px;max-width:100%}.section-nav a{flex:none;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none;color:var(--fg-soft);background:var(--card);border:1px solid var(--line);padding:9px 15px;border-radius:999px;font-size:12px;font-weight:650}.section-nav a:hover{background:var(--accent);color:var(--accent-on)}a:focus-visible{outline:3px solid var(--blue);outline-offset:2px}h2{scroll-margin-top:24px;letter-spacing:-.02em}.dashboard-card[data-component-type="metric"]{position:relative;overflow:hidden;border-top:3px solid var(--chart-accent)}.metric-value{font-size:clamp(32px,3.5vw,48px);letter-spacing:-.045em;font-variant-numeric:tabular-nums}.status-pill{display:inline-block;background:var(--bg-2);color:var(--fg);border:1px solid var(--line);border-radius:999px;font-size:11px;font-weight:650;padding:4px 9px;overflow-wrap:anywhere;max-width:100%}.board-lanes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px;align-items:start}.board-lane{min-width:0;background:var(--bg);padding:14px;border-radius:14px;border:1px solid var(--line)}.lane-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 16px}.lane-count{font:12px var(--mono-font);color:var(--fg-soft)}.record-card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:16px;margin-top:10px;overflow-wrap:anywhere}.record-card h4{font-size:15px;line-height:1.4;margin:8px 0 20px;letter-spacing:-.02em}.record-category{font-size:10px;color:var(--fg-soft);letter-spacing:.06em}.record-meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--fg-soft)}.record-meta strong{color:var(--fg);font-variant-numeric:tabular-nums}.insight-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;margin:20px 0}.insight-grid>div{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}.insight-grid dt{font-size:11px;color:var(--fg-soft)}.insight-grid dd{font-weight:750;font-size:20px;letter-spacing:-.025em;margin:8px 0 0;overflow-wrap:anywhere}.insight-heading{font-size:13px;margin:24px 0 12px}.insight-breakdown{list-style:none;margin:0;padding:0}.insight-breakdown li{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;border-bottom:1px solid var(--line);padding:12px 0;font-size:12px;overflow-wrap:anywhere}.session-notice{background:var(--bg);border-left:3px solid var(--chart-accent);border-radius:8px;padding:14px 16px;font-size:12px;color:var(--fg-soft);margin-bottom:20px}.record-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:16px;margin:20px 0}.form-actions{display:flex;flex-wrap:wrap;gap:10px}.primary-button{background:var(--accent);color:var(--accent-on);border-color:var(--accent)}.form-message{font-size:12px;color:var(--fg-soft);overflow-wrap:anywhere}.description,.dashboard-card h2{overflow-wrap:anywhere}@media(max-width:900px){.dashboard-card[data-component-type="board"],.dashboard-card[data-component-type="form"],.dashboard-card[data-component-type="insights"]{grid-column:span 12}}@media(prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}' +
      '.workflow-phases{list-style:none;margin:24px 0 0;padding:0;display:grid;gap:28px}.workflow-phase{position:relative;min-width:0;border:1px solid var(--line);border-left:4px solid var(--chart-accent);border-radius:14px;padding:22px;background:var(--bg)}.workflow-phase+.workflow-phase:before{content:"↓";position:absolute;top:-28px;left:24px;height:27px;color:var(--chart-accent);font-size:20px}.workflow-phase-header{display:flex;align-items:center;gap:12px}.workflow-step{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:10px;background:var(--accent);color:var(--accent-on);font:700 14px var(--mono-font)}.workflow-phase h3{font-size:18px;letter-spacing:-.025em;margin:0;overflow-wrap:anywhere}.workflow-purpose,.workflow-detail{color:var(--fg-soft);font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.workflow-purpose{margin:14px 0}.workflow-summary{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px}.workflow-count{font:12px var(--mono-font);color:var(--fg-soft)}.workflow-summary progress{flex:1 1 140px;max-width:360px;height:10px;accent-color:var(--chart-accent)}.workflow-items{list-style:none;padding:0;margin:16px 0 0;display:grid;gap:10px}.workflow-item{display:flex;flex-direction:row;align-items:start;gap:12px;padding:14px;background:var(--card);border:1px solid var(--line);border-radius:10px;cursor:pointer;font-size:14px}.workflow-item input{flex:none;width:20px;height:20px;min-height:20px;margin:2px 0;accent-color:var(--chart-accent);cursor:pointer}.workflow-item>span{min-width:0}.workflow-label{display:block;white-space:pre-wrap;overflow-wrap:anywhere}.workflow-detail{display:block;font-weight:400;margin-top:5px}.workflow-item:has(input:checked){border-color:var(--chart-accent)}@media(max-width:900px){.dashboard-card[data-component-type="workflow"]{grid-column:span 12}}@media(max-width:600px){.workflow-phase{padding:16px}}' +
      '</style></head><body><header class="top-bar"><div class="brand-logo">TH</div><span class="badge">STUDIO / OFFLINE APPLICATION</span></header><main><div class="hero"><p class="eyebrow">YOUR WORKSPACE, REIMAGINED</p><h1>' + escapeHTML(config.title) + '</h1><p class="description">' + escapeHTML(config.description) + '</p><p id="dashboard-status" class="status" role="status" aria-live="polite"></p></div>' + navigation + '<div id="dashboard-components" class="dashboard-grid"><div id="dashboard-metrics">' + metricCards + '</div>' + otherCards + '</div><footer>Self-contained application · Tektonik hub Studio</footer></main><script id="blk-dashboard-config" type="application/json">' + inlineJSON(config) + '</script><script>(' + dashboardRuntime.toString() + ')();</script></body></html>';
    if (bytes(html) >= 200000) throw new Error('Dashboard HTML exceeds 200KB');
    return html;
  }
  return { createConfig, validate, renderHTML, context, templates: clone(templates), registry: clone(registry), schema: clone(schema) };
});
