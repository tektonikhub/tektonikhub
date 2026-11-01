/* Local, deterministic templates. No model, backend or remote assets are used. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLKStudioEngine = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var templates = {
    dashboard: { title: 'Panel de operaciones', area: 'Operaciones' },
    calculator: { title: 'Calculadora de ahorro', area: 'Finanzas' },
    form: { title: 'Centro de solicitudes', area: 'Operaciones' },
    kanban: { title: 'Tablero de tareas', area: 'Equipo' }
  };
  var accents = { azul: '#2563EB', violeta: '#7C3AED', verde: '#0B7A48', amarillo: '#FEFF44' };
  var csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";

  function fold(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function kindFrom(text) {
    if (/\b(expenses?|gastos?|roi|calculadora?|calculator)\b/.test(text)) return 'calculator';
    if (/\b(formulario|solicitudes?|form)\b/.test(text)) return 'form';
    if (/\b(kanban|tareas?)\b/.test(text)) return 'kanban';
    if (/\b(dashboard|panel)\b/.test(text)) return 'dashboard';
    return null;
  }

  function normalizeSpec(value) {
    value = value && typeof value === 'object' ? value : {};
    var kind = Object.prototype.hasOwnProperty.call(templates, value.kind) ? value.kind : 'dashboard';
    var accent = accents[value.accent] || value.accent;
    if (Object.keys(accents).map(function (name) { return accents[name]; }).indexOf(accent) < 0) accent = accents.amarillo;
    return {
      kind: kind,
      title: typeof value.title === 'string' && value.title.trim() ? value.title.slice(0, 160) : templates[kind].title,
      description: typeof value.description === 'string' ? value.description.slice(0, 600) : 'Aplicación de demostración con datos sintéticos.',
      accent: accent,
      dark: value.dark === true,
      compact: value.compact === true,
      chart: typeof value.chart === 'boolean' ? value.chart : kind === 'dashboard',
      search: typeof value.search === 'boolean' ? value.search : kind !== 'calculator',
      area: typeof value.area === 'string' && value.area.trim() ? value.area.slice(0, 80) : templates[kind].area
    };
  }

  function feature(text, word, current) {
    var pattern = new RegExp('(?:\\b(sin|quita|quitar|elimina|eliminar|retira|retirar|oculta|ocultar|no|anade|anadir|agrega|agregar|incluye|incluir|con|muestra|mostrar)\\b\\s+(?:(?:el|un|una|la)\\s+)?)?\\b(' + word + ')\\b', 'g');
    var match;
    while ((match = pattern.exec(text))) {
      current = !/^(sin|quita|quitar|elimina|eliminar|retira|retirar|oculta|ocultar|no)$/.test(match[1] || '');
    }
    return current;
  }

  /** Derive a serializable specification without mutating the previous one. */
  function createSpec(prompt, previousSpec) {
    var raw = String(prompt == null ? '' : prompt).trim();
    var text = fold(raw);
    var previous = previousSpec ? normalizeSpec(previousSpec) : null;
    var switchMatch = /\b(?:convierte(?:lo)?|convertir|cambia(?:lo)?|cambiar|transforma(?:lo)?)\b\s+(?:(?:esto|la app|el panel|el tablero)\s+)?(?:a|en)\s+(.+)/.exec(text);
    var kind = previous ? previous.kind : (kindFrom(text) || 'dashboard');
    if (previous && switchMatch) kind = kindFrom(switchMatch[1]) || kind;
    var spec = previous ? normalizeSpec(previous) : normalizeSpec({ kind: kind, description: raw || undefined });
    spec.kind = kind;
    if (previous && previous.kind !== kind) spec.area = templates[kind].area;

    var titleMatch = /\b(?:ll[aá]malo|ll[aá]mala|t[ií]tulo)\s*(?::|=)?\s+(?:["“]([^"”]+)["”]|'([^']+)'|([^\n]+))/i.exec(raw);
    if (titleMatch) spec.title = (titleMatch[1] || titleMatch[2] || titleMatch[3]).trim().slice(0, 160) || spec.title;

    var directive = /\b(oscuro|oscura|claro|clara|azul|violeta|verde|amarillo|amarilla|compacta|compacto|compactar|espacioso|espaciosa)\b/g;
    var match;
    while ((match = directive.exec(text))) {
      var token = match[1];
      if (/^(oscuro|oscura|claro|clara)$/.test(token)) spec.dark = /^oscur/.test(token);
      else if (/^(compacta|compacto|compactar|espacioso|espaciosa)$/.test(token)) spec.compact = /^compact/.test(token);
      else spec.accent = accents[token === 'amarilla' ? 'amarillo' : token];
    }
    spec.chart = feature(text, 'grafico|grafica|chart', spec.chart);
    spec.search = feature(text, 'buscador|busqueda|search', spec.search);
    return spec;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function explainChanges(previousSpec, spec) {
    var next = normalizeSpec(spec);
    if (!previousSpec) return 'Demo local creada: ' + templates[next.kind].title.toLowerCase() + '. Usa datos sintéticos, sin IA ni backend.';
    var prev = normalizeSpec(previousSpec);
    var changes = [];
    if (prev.kind !== next.kind) changes.push('plantilla de ' + templates[next.kind].title.toLowerCase());
    if (prev.title !== next.title) changes.push('título actualizado');
    if (prev.dark !== next.dark) changes.push(next.dark ? 'tema oscuro' : 'tema claro');
    if (prev.accent !== next.accent) changes.push('nuevo color de acento');
    if (prev.compact !== next.compact) changes.push(next.compact ? 'diseño compacto' : 'diseño espacioso');
    if (prev.chart !== next.chart) changes.push(next.chart ? 'gráfico añadido' : 'gráfico eliminado');
    if (prev.search !== next.search) changes.push(next.search ? 'buscador añadido' : 'buscador eliminado');
    return changes.length ? 'Demo local: ' + changes.join(', ') + '.' : 'Sin cambios reconocidos. Prueba «tema oscuro», «añade buscador» o «convierte a kanban».';
  }

  function card(label, value, detail, id) {
    return '<article class="card metric"><span class="eyebrow">' + label + '</span><strong' + (id ? ' id="' + id + '"' : '') + '>' + value + '</strong><span class="muted">' + detail + '</span></article>';
  }

  function searchBox(spec, placeholder) {
    return spec.search ? '<label class="search"><span class="sr-only">Buscar</span><input id="search" type="search" placeholder="' + placeholder + '" autocomplete="off"></label>' : '';
  }

  function chartHTML() {
    return '<section class="card chart-panel" aria-labelledby="chart-heading"><div class="section-heading"><div><span class="eyebrow">DATOS SINTÉTICOS</span><h2 id="chart-heading">Actividad semanal</h2></div><span class="pill">Ejemplo</span></div><div class="chart" role="img" aria-label="Actividad de ejemplo: lunes 35, martes 62, miércoles 48, jueves 83 y viernes 70">' +
      [35, 62, 48, 83, 70].map(function (height, i) {
        return '<div class="bar-column"><span class="bar-value">' + height + '</span><div class="bar" style="height:' + height + '%"></div><span>' + ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'][i] + '</span></div>';
      }).join('') + '</div></section>';
  }

  function calculatorHTML(spec) {
    return '<div class="metrics">' + card('AHORRO MENSUAL', '<span id="savings">2.400 €</span>', 'Estimación con tus valores', 'monthly-saving') + card('HORAS LIBERADAS / MES', '80 h', 'Cuatro semanas por mes', 'hours-saved') + card('AHORRO ANUAL', '28.800 €', 'Proyección de doce meses', 'annual-saving') + '</div>' +
      '<div class="split"><section class="card"><div class="section-heading"><div><span class="eyebrow">SIMULADOR</span><h2>Calcula el impacto</h2></div><span class="pill">Local</span></div><p class="muted">Horas ahorradas por persona y semana × equipo × tarifa. No incluye costes de implantación.</p><form id="calculator-form"><label>Horas ahorradas / semana<input id="hours" name="hours" type="number" min="0" max="168" step="0.5" value="4" required></label><label>Tarifa por hora (€)<input id="rate" name="rate" type="number" min="0" max="100000" step="0.01" value="30" required></label><label>Personas del equipo<input id="team" name="team" type="number" min="1" max="10000" step="1" value="5" required></label><button id="calculate-savings" class="primary" type="button">Calcular ahorro</button><p id="calculation-status" class="muted" role="status" aria-live="polite">Modifica los valores para explorar escenarios.</p></form></section><section class="card"><span class="eyebrow">ESCENARIOS DE EJEMPLO</span><h2>Pequeños cambios, más tiempo</h2>' + searchBox(spec, 'Buscar escenario…') + '<ul id="scenario-list" class="item-list"><li>Finanzas · conciliación de gastos</li><li>Equipo · informes semanales</li><li>Operaciones · revisión de solicitudes</li></ul><div class="note">Esta calculadora usa una fórmula fija. Los resultados no son una predicción ni asesoramiento financiero.</div></section></div>';
  }

  function formHTML(spec) {
    return '<div class="metrics">' + card('SOLICITUDES LOCALES', '3', 'Datos de ejemplo en esta vista', 'request-count') + card('TIEMPO DE RESPUESTA', '—', 'Sin servicio de envío conectado') + card('MODO DE TRABAJO', 'Demo', 'La recarga reinicia los datos') + '</div>' +
      '<div class="split"><section class="card"><span class="eyebrow">NUEVA SOLICITUD</span><h2>Cuéntanos qué necesitas</h2><form id="request-form"><label>Nombre<input name="name" type="text" maxlength="80" placeholder="Tu nombre" required></label><label>Asunto<input name="subject" type="text" maxlength="120" placeholder="Ej. Acceso al espacio de equipo" required></label><label>Prioridad<select name="priority"><option>Normal</option><option>Alta</option><option>Baja</option></select></label><label>Detalles<textarea name="details" maxlength="600" rows="3" placeholder="Añade contexto (opcional)"></textarea></label><button id="add-request" class="primary" type="button">Añadir solicitud local</button><p id="request-status" class="muted" role="status" aria-live="polite">No se envían datos. Usa información ficticia.</p></form></section><section class="card"><div class="section-heading"><div><span class="eyebrow">BANDEJA LOCAL</span><h2>Solicitudes recientes</h2></div><span class="pill">Sintéticas</span></div>' + searchBox(spec, 'Buscar por nombre o asunto…') + '<ul id="request-list" class="item-list"></ul><p id="request-empty" class="muted" hidden>No hay solicitudes que coincidan.</p></section></div>';
  }

  function kanbanHTML(spec) {
    return '<div class="metrics">' + card('TAREAS', '5', 'Ejemplos editables en memoria', 'task-count') + card('EN CURSO', '2', 'Mueve las tarjetas para actualizar', 'progress-count') + card('COMPLETADAS', '1', 'Avance del equipo de ejemplo', 'done-count') + '</div>' +
      '<section class="card"><div class="section-heading"><div><span class="eyebrow">PLANIFICACIÓN LOCAL</span><h2>El trabajo, a simple vista</h2></div>' + searchBox(spec, 'Buscar tarea…') + '</div><form id="task-form" class="inline-form"><label class="grow"><span class="sr-only">Nueva tarea</span><input name="task" type="text" maxlength="140" placeholder="Escribe una nueva tarea…" required></label><button id="add-task" class="primary" type="button">Añadir tarea</button></form><p id="task-status" class="muted" role="status" aria-live="polite">Las tareas se guardan solo mientras esta vista está abierta.</p><div class="kanban"><section class="column"><h3>Por hacer</h3><div id="todo-list"></div></section><section class="column"><h3>En curso</h3><div id="doing-list"></div></section><section class="column"><h3>Hecho</h3><div id="done-list"></div></section></div></section>';
  }

  function dashboardHTML(spec) {
    return '<div class="metrics">' + card('VOLUMEN DE EJEMPLO', '18.400 €', 'Total de entradas visibles', 'entry-total') + card('ENTRADAS LOCALES', '4', 'Añade registros sintéticos', 'entry-count') + card('EQUIPOS ACTIVOS', '3', 'Operaciones, Finanzas y Equipo') + '</div>' +
      '<section class="card" id="activity"><div class="section-heading"><div><span class="eyebrow">VISTA GENERAL</span><h2>Actividad reciente</h2></div><button id="add-entry" class="primary" type="button">+ Añadir entrada demo</button></div><div class="toolbar">' + searchBox(spec, 'Buscar equipo, entrada o estado…') + '<span class="muted">Todos los registros son sintéticos.</span></div><div class="table-wrap"><table><thead><tr><th scope="col">Entrada</th><th scope="col">Equipo</th><th scope="col">Importe</th><th scope="col">Estado</th></tr></thead><tbody id="entry-list"></tbody></table></div><p id="entry-empty" class="muted" hidden>No se encontraron entradas.</p><p id="entry-status" class="muted" role="status" aria-live="polite">Los cambios se reinician al recargar.</p></section>';
  }

  var css = `
*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:var(--bg);color:var(--fg);font:14px var(--body-font);line-height:1.5}body.dark{color-scheme:dark;--bg:#151719;--bg-2:#23262a;--card:#1d2023;--fg:#f2f3ee;--fg-soft:#c5c8c3;--muted:#a0a59f;--line:#34383b}button,input,select,textarea{font:inherit}button{cursor:pointer}button,a,input,select,textarea{outline-offset:4px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--accent)}button{border:1px solid var(--line);border-radius:var(--r-sm);padding:10px 15px;background:var(--card);color:var(--fg);font-weight:700}button:hover{filter:brightness(.94)}.primary{background:var(--accent);color:var(--accent-on);border-color:transparent}.topbar{min-height:var(--topbar-h);padding:12px 26px;display:flex;align-items:center;justify-content:space-between;gap:16px;background:var(--card);border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:12px;font-weight:800;min-width:0}.mark{width:34px;height:34px;flex-shrink:0;border-radius:10px;background:var(--fg);color:var(--bg);display:grid;place-items:center;font-size:18px}.brand-name{overflow-wrap:anywhere}.pill{border-radius:100px;padding:5px 10px;background:var(--bg-2);font:11px var(--mono-font);white-space:nowrap}.shell{display:grid;grid-template-columns:var(--sidebar-w) minmax(0,1fr);min-height:calc(100vh - var(--topbar-h))}.sidebar{padding:30px 18px;border-right:1px solid var(--line);display:flex;flex-direction:column;gap:12px}.sidebar a{padding:11px 14px;border-radius:9px;text-decoration:none;color:var(--fg-soft);font-weight:700}.sidebar a.active{background:var(--fg);color:var(--bg)}.sidebar .note{margin-top:auto}.eyebrow{font:10px var(--mono-font);font-weight:700;letter-spacing:.12em;color:var(--muted);display:block}.sidebar .eyebrow{padding:0 14px}.main{padding:36px;max-width:1440px;width:100%;margin:auto}.page-heading{margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.page-heading>div{min-width:0}h1{font:800 clamp(26px,3vw,38px) var(--display-font);letter-spacing:-.04em;margin:7px 0 10px;overflow-wrap:anywhere}h2{font:750 20px var(--display-font);letter-spacing:-.025em;margin:5px 0 14px}h3{font-size:13px;margin:0 0 16px}.description{max-width:720px;margin:0;color:var(--fg-soft);overflow-wrap:anywhere}.muted{color:var(--muted);font-size:12px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-bottom:22px}.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);padding:24px;box-shadow:var(--shadow);min-width:0}.metric{display:flex;flex-direction:column;gap:12px}.metric strong{font:750 clamp(22px,3vw,32px) var(--display-font);letter-spacing:-.03em;overflow-wrap:anywhere}.split{display:grid;grid-template-columns:1fr 1fr;gap:22px}.section-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}.section-heading h2{margin-bottom:0}form{display:grid;gap:16px;margin-top:20px}label{font-size:12px;font-weight:650;display:grid;gap:7px}input,textarea,select{width:100%;padding:11px 12px;border-radius:var(--r-sm);background:var(--bg);color:var(--fg);border:1px solid var(--line);min-width:0}textarea{resize:vertical}input::placeholder,textarea::placeholder{color:var(--muted)}.search{width:100%;max-width:340px}.toolbar{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:18px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}th{font:10px var(--mono-font);text-transform:uppercase;color:var(--muted);letter-spacing:.07em}td,th{padding:15px 12px;border-bottom:1px solid var(--line)}td:first-child{font-weight:650}td .pill{display:inline-block}.item-list{list-style:none;padding:0;margin:18px 0 0}.item-list li{padding:14px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.item-title{font-weight:700;display:block}.item-meta{font-size:12px;color:var(--muted);margin-top:5px;display:block}.note{font-size:12px;color:var(--muted);padding:16px;background:var(--bg-2);border-radius:var(--r-sm);margin-top:24px}.inline-form{display:flex;align-items:center;gap:12px}.grow{flex:1}.kanban{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:24px}.column{border-radius:12px;padding:15px;background:var(--bg);min-width:0}.task{border:1px solid var(--line);border-radius:10px;background:var(--card);padding:14px;margin-bottom:12px}.task p{margin:0 0 14px;font-weight:650;overflow-wrap:anywhere}.task label{font-size:11px;color:var(--muted)}.task select{padding:7px;font-size:12px}.chart-panel{margin-top:22px}.chart{height:200px;display:flex;align-items:stretch;gap:clamp(10px,5vw,70px);padding:10px 20px 0;border-bottom:1px solid var(--line)}.bar-column{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:6px;color:var(--muted);font-size:11px}.bar{width:100%;max-width:70px;background:var(--accent);border-radius:6px 6px 0 0;min-height:8px}.bar-value{color:var(--fg);font:11px var(--mono-font)}.footer{margin-top:24px;font-size:11px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}[hidden]{display:none!important}.compact .main{padding:22px}.compact .card{padding:16px}.compact .metrics{gap:12px;margin-bottom:14px}.compact td,.compact th{padding:10px}.compact form{gap:10px}.compact .page-heading{margin-bottom:18px}@media(max-width:1000px){.shell{grid-template-columns:190px minmax(0,1fr)}.main{padding:24px}.split{grid-template-columns:1fr}.metrics{gap:12px}.card{padding:18px}}@media(max-width:700px){.topbar{padding:12px 16px}.shell{grid-template-columns:1fr}.sidebar{padding:12px 16px;border-right:0;border-bottom:1px solid var(--line);flex-direction:row;align-items:center;flex-wrap:wrap}.sidebar .note,.sidebar .eyebrow{display:none}.sidebar a{padding:8px 12px;font-size:12px}.main,.compact .main{padding:20px 16px}.metrics{grid-template-columns:1fr}.metric{gap:6px}.kanban{grid-template-columns:1fr}.page-heading{flex-direction:column}.inline-form{flex-wrap:wrap}.inline-form .grow{flex-basis:100%}.section-heading .primary{width:100%}.chart{gap:12px;padding-inline:0}.pill{font-size:10px}}
`;

  /* Only fixed template code is embedded in the output script. User text stays in HTML text nodes. */
  function appRuntime() {
    'use strict';
    var kind = document.body.dataset.kind;
    var currency = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
    var requests = [
      { name: 'Ana Demo', subject: 'Acceso a informes', priority: 'Normal', details: 'Datos sintéticos' },
      { name: 'Luis Demo', subject: 'Revisión de equipo', priority: 'Alta', details: 'Ejemplo local' },
      { name: 'Marta Demo', subject: 'Material de bienvenida', priority: 'Baja', details: 'Solicitud de ejemplo' }
    ];
    var tasks = [
      { id: 1, title: 'Preparar el informe semanal', status: 'todo' },
      { id: 2, title: 'Revisar solicitudes del equipo', status: 'todo' },
      { id: 3, title: 'Diseñar el nuevo flujo', status: 'doing' },
      { id: 4, title: 'Validar los datos de ejemplo', status: 'doing' },
      { id: 5, title: 'Compartir la planificación', status: 'done' }
    ];
    var entries = [
      { title: 'Informe mensual', team: 'Finanzas', amount: 6400, status: 'Completado' },
      { title: 'Planificación de recursos', team: 'Operaciones', amount: 4800, status: 'En curso' },
      { title: 'Material de bienvenida', team: 'Equipo', amount: 2200, status: 'Completado' },
      { title: 'Revisión de procesos', team: 'Operaciones', amount: 5000, status: 'Pendiente' }
    ];
    var nextTaskId = 6;

    function byId(id) { return document.getElementById(id); }
    function setText(id, value) { var element = byId(id); if (element) element.textContent = String(value); }
    function node(tag, text, className) {
      var element = document.createElement(tag);
      if (text != null) element.textContent = String(text);
      if (className) element.className = className;
      return element;
    }
    function folded(text) { return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
    function query() { return byId('search') ? folded(byId('search').value.trim()) : ''; }
    function matches(text) { return folded(text).indexOf(query()) !== -1; }
    function bind(id, event, callback) { var element = byId(id); if (element) element.addEventListener(event, callback); }
    /* Native form submission is blocked even with preventDefault in an allow-scripts-only sandbox. */
    function bindLocalForm(formId, buttonId, callback) {
      bind(buttonId, 'click', callback);
      bind(formId, 'keydown', function (event) {
        if (event.key !== 'Enter' || event.isComposing || event.target.tagName !== 'INPUT') return;
        event.preventDefault();
        if (!event.repeat) callback(event);
      });
    }

    function calculateSavings(hours, rate, team) {
      if ([hours, rate, team].some(function (value) { return value == null || String(value).trim() === ''; })) return null;
      hours = Number(hours); rate = Number(rate); team = Number(team);
      if (!Number.isFinite(hours) || !Number.isFinite(rate) || !Number.isFinite(team) || hours < 0 || hours > 168 || rate < 0 || rate > 100000 || team < 1 || team > 10000 || !Number.isInteger(team)) return null;
      var savedHours = hours * team * 4;
      return { hours: savedHours, monthly: savedHours * rate, annual: savedHours * rate * 12 };
    }
    function updateSavings(event) {
      if (event) event.preventDefault();
      var result = calculateSavings(byId('hours').value, byId('rate').value, byId('team').value);
      if (!result) { setText('calculation-status', 'Introduce valores válidos y un número entero de personas.'); return; }
      setText('savings', currency.format(result.monthly));
      setText('annual-saving', currency.format(result.annual));
      setText('hours-saved', new Intl.NumberFormat('es-ES').format(result.hours) + ' h');
      setText('calculation-status', 'Estimación local actualizada. Cuatro semanas por mes; doce meses por año.');
    }

    function renderRequests() {
      var list = byId('request-list');
      list.replaceChildren();
      var visible = requests.filter(function (item) { return matches(item.name + ' ' + item.subject + ' ' + item.priority + ' ' + item.details); });
      visible.forEach(function (item) {
        var row = node('li');
        row.appendChild(node('span', item.subject, 'item-title'));
        row.appendChild(node('span', item.name + ' · ' + item.priority + ' · Local', 'item-meta'));
        if (item.details) row.appendChild(node('span', item.details, 'item-meta'));
        list.appendChild(row);
      });
      setText('request-count', requests.length);
      byId('request-empty').hidden = visible.length > 0;
    }
    function submitRequest(event) {
      event.preventDefault();
      var form = byId('request-form');
      if (!form.reportValidity()) return;
      var name = form.elements.namedItem('name').value.trim().slice(0, 80);
      var subject = form.elements.namedItem('subject').value.trim().slice(0, 120);
      if (!name || !subject) { setText('request-status', 'Completa el nombre y el asunto.'); return; }
      requests.unshift({ name: name, subject: subject, priority: form.elements.namedItem('priority').value, details: form.elements.namedItem('details').value.trim().slice(0, 600) });
      form.reset();
      if (byId('search')) byId('search').value = '';
      renderRequests();
      setText('request-status', 'Solicitud añadida solo a esta demo. No se ha enviado a ningún servidor.');
    }

    function renderTasks() {
      ['todo', 'doing', 'done'].forEach(function (status) {
        var list = byId(status + '-list');
        list.replaceChildren();
        var visible = tasks.filter(function (task) { return task.status === status && matches(task.title); });
        visible.forEach(function (task) {
          var card = node('article', null, 'task');
          card.appendChild(node('p', task.title));
          var label = node('label', 'Mover tarea');
          var select = node('select');
          select.setAttribute('aria-label', 'Estado de ' + task.title);
          ['todo', 'doing', 'done'].forEach(function (value, index) {
            var option = node('option', ['Por hacer', 'En curso', 'Hecho'][index]);
            option.value = value;
            select.appendChild(option);
          });
          select.value = task.status;
          select.addEventListener('change', function () { moveTask(task.id, select.value); });
          label.appendChild(select);
          card.appendChild(label);
          list.appendChild(card);
        });
        if (!visible.length) list.appendChild(node('p', 'Sin tareas en esta vista.', 'muted'));
      });
      setText('task-count', tasks.length);
      setText('progress-count', tasks.filter(function (task) { return task.status === 'doing'; }).length);
      setText('done-count', tasks.filter(function (task) { return task.status === 'done'; }).length);
    }
    function addTask(event) {
      event.preventDefault();
      var form = byId('task-form');
      if (!form.reportValidity()) return;
      var title = form.elements.namedItem('task').value.trim().slice(0, 140);
      if (!title) { setText('task-status', 'Escribe una tarea antes de añadirla.'); return; }
      tasks.push({ id: nextTaskId++, title: title, status: 'todo' });
      form.reset();
      if (byId('search')) byId('search').value = '';
      renderTasks();
      setText('task-status', 'Tarea añadida localmente.');
    }
    function moveTask(id, status) {
      if (['todo', 'doing', 'done'].indexOf(status) < 0) return;
      var task = tasks.find(function (item) { return item.id === id; });
      if (!task) return;
      task.status = status;
      renderTasks();
      setText('task-status', 'Estado actualizado solo en esta vista.');
      var moved = document.querySelector('[aria-label="Estado de ' + CSS.escape(task.title) + '"]');
      if (moved) moved.focus();
    }

    function renderEntries() {
      var list = byId('entry-list');
      list.replaceChildren();
      var visible = entries.filter(function (entry) { return matches(entry.title + ' ' + entry.team + ' ' + entry.status); });
      visible.forEach(function (entry) {
        var row = node('tr');
        row.appendChild(node('td', entry.title));
        row.appendChild(node('td', entry.team));
        row.appendChild(node('td', currency.format(entry.amount)));
        var status = node('td');
        status.appendChild(node('span', entry.status, 'pill'));
        row.appendChild(status);
        list.appendChild(row);
      });
      setText('entry-count', visible.length);
      setText('entry-total', currency.format(visible.reduce(function (sum, entry) { return sum + entry.amount; }, 0)));
      byId('entry-empty').hidden = visible.length > 0;
    }
    function addEntry() {
      entries.unshift({ title: 'Entrada demo ' + (entries.length + 1), team: 'Operaciones', amount: 1200, status: 'Pendiente' });
      if (byId('search')) byId('search').value = '';
      renderEntries();
      setText('entry-status', 'Entrada sintética añadida. No se ha guardado fuera de esta vista.');
    }
    function filterData() {
      if (kind === 'dashboard') renderEntries();
      if (kind === 'form') renderRequests();
      if (kind === 'kanban') renderTasks();
      if (kind === 'calculator') {
        Array.prototype.forEach.call(byId('scenario-list').children, function (item) { item.hidden = !matches(item.textContent); });
      }
    }

    bind('search', 'input', filterData);
    if (kind === 'calculator') {
      bindLocalForm('calculator-form', 'calculate-savings', function (event) {
        if (byId('calculator-form').reportValidity()) updateSavings(event);
      });
      ['hours', 'rate', 'team'].forEach(function (id) { bind(id, 'input', updateSavings); });
      updateSavings();
    }
    if (kind === 'form') { bindLocalForm('request-form', 'add-request', submitRequest); renderRequests(); }
    if (kind === 'kanban') { bindLocalForm('task-form', 'add-task', addTask); renderTasks(); }
    if (kind === 'dashboard') { bind('add-entry', 'click', addEntry); renderEntries(); }
  }

  /** Render a full, offline document suitable for an allow-scripts-only sandbox. */
  function renderHTML(input) {
    var spec = normalizeSpec(input);
    var renderers = { dashboard: dashboardHTML, calculator: calculatorHTML, form: formHTML, kanban: kanbanHTML };
    var accentOn = spec.accent === accents.amarillo ? '#111111' : '#FFFFFF';
    var tokens = ':root{--bg:#EFEFEB;--bg-2:#E4E4DF;--card:#FFFFFF;--fg:#111111;--fg-soft:#444444;--muted:#777777;--line:#E2E2DE;--accent:' + spec.accent + ';--accent-on:' + accentOn + ';--green:#0B7A48;--green-bg:#E8F5EE;--amber:#B45309;--amber-bg:#FEF3C7;--red:#B91C1C;--red-bg:#FEE2E2;--blue:#1D4ED8;--blue-bg:#EFF6FF;--display-font:system-ui,-apple-system,sans-serif;--body-font:system-ui,-apple-system,sans-serif;--mono-font:ui-monospace,monospace;--r-card:16px;--r-sm:8px;--sidebar-w:230px;--topbar-h:60px;--shadow:0 8px 24px -10px rgba(0,0,0,.08);--shadow-lg:0 20px 40px rgba(0,0,0,.16)}';
    return '<!DOCTYPE html>\n<html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHTML(spec.title) + '</title><style>' + tokens + css + '</style></head>' +
      '<body data-kind="' + spec.kind + '" data-theme="' + (spec.dark ? 'dark' : 'light') + '" class="' + (spec.dark ? 'dark ' : '') + (spec.compact ? 'compact' : '') + '"><header class="topbar"><div class="brand"><span class="mark" aria-hidden="true">▦</span><span class="brand-name">' + escapeHTML(spec.title) + '</span></div><span class="pill">DEMO LOCAL</span></header><div class="shell"><aside class="sidebar" aria-label="Navegación de la aplicación"><span class="eyebrow">ESPACIO DE TRABAJO</span><a class="active" href="#overview">Resumen</a><a href="#workspace">' + escapeHTML(templates[spec.kind].area) + '</a><a href="#demo-info">Sobre esta demo</a><div class="note">Plantilla local · datos sintéticos.<br>Sin IA ni servicios conectados.</div></aside><main class="main" id="overview"><div class="page-heading"><div><span class="eyebrow">' + escapeHTML(spec.area) + '</span><h1>' + escapeHTML(spec.title) + '</h1><p class="description">' + escapeHTML(spec.description) + '</p></div><span class="pill">Vista interactiva</span></div><div id="workspace">' + renderers[spec.kind](spec) + (spec.chart ? chartHTML() : '') + '</div><footer class="footer" id="demo-info">Demo de plantilla local. Datos sintéticos; los cambios viven solo en memoria y se pierden al recargar. No hay IA, envío de datos ni backend.</footer></main></div><script>(' + appRuntime.toString() + ')();</script></body></html>';
  }

  return { createSpec: createSpec, renderHTML: renderHTML, explainChanges: explainChanges };
}));
