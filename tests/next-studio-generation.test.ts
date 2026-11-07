import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { expansionRequest, generateStudioApplication, STUDIO_GENERATION_TIMEOUT, studioBriefSchema, type StudioCompletion } from '../lib/studio/generation';
import type { DashboardKit } from '../lib/studio/types';
import { generateHTMLApplication, htmlBriefSchema, htmlExpansionRequest, validateHTMLApplication } from '../lib/studio/html-generation';
import { validateGeneratedHTML } from '../lib/studio/html-validation';
import { htmlApplication, htmlBrief } from './next-studio-html-fixture';
const require = createRequire(import.meta.url);
const kit: DashboardKit = require('../lib/studio/runtime/dashboard-kit.js');
const config = kit.createConfig('ventas');
const brief = {
  summary: 'Gestiona oportunidades y revisa el rendimiento comercial.', audience: 'Equipo comercial', scope: 'full',
  workflows: ['Explorar oportunidades y revisar tendencias'],
  features: config.components.map(component => ({ type: component.type, title: component.title, purpose: 'Ayudar al equipo a tomar decisiones' })),
  design: { accent: '#60A5FA', dark: false }, assumptions: ['Los registros son ficticios'],
  acceptanceCriteria: ['Los filtros actualizan las vistas'], limitations: ['Sin CRM externo'],
};
test('Studio builds focused adoption workflows and repairs missing or reordered planned phases once', async () => {
  const titles = ['Fundamentos', 'Primer agente', 'Cowork: ejecución supervisada'];
  const focused = { ...brief, scope: 'focused', features: [{ type: 'workflow', title: 'Adopción de IA', purpose: 'Checklist por fase', phaseTitles: titles }] };
  const phases = titles.map((title, index) => ({ id: 'phase' + index, title, description: 'Objetivo y criterio de salida', items: [{ id: 'check' + index, label: 'Revisar resultados antes de avanzar', checked: false }] }));
  const workflow = kit.validate({ ...config, title: 'Adopción de IA', data: [], components: [{ id: 'adoption', type: 'workflow', title: 'Adopción de IA', span: 12, phases }] });
  const calls: StudioCompletion[] = [];
  const result = await generateStudioApplication('Tres fases: fundamentos, primer agente y cowork, con checklists', null, kit, async call => {
    calls.push(call);
    return call.stage === 'expand' ? focused : call.stage === 'compose' ? { ...workflow, components: [{ ...workflow.components[0], phases: phases.slice(0, 2) }] } : workflow;
  });
  assert.deepEqual(calls.map(call => call.stage), ['expand', 'compose', 'repair']);
  assert.deepEqual(result.config.components[0].phases?.map(phase => phase.title), titles);
  assert.deepEqual(result.config.data, []);
  assert.match(JSON.parse(calls[2].input).validationError, /exact number and order/);
  assert.match(calls[0].instructions, /educational diagrams/);
  assert.match(calls[1].instructions, /supervised AI execution/);
  assert.equal(calls[0].maxOutputTokens, 6000);
  const wrong = { ...workflow, components: [{ ...workflow.components[0], phases: [...phases].reverse() }] };
  await assert.rejects(generateStudioApplication('Tres fases', null, kit, async call => call.stage === 'expand' ? focused : wrong), /exact number and order/);
  assert.equal(studioBriefSchema.safeParse({ ...focused, features: [{ ...focused.features[0], type: 'text' }] }).success, false);
});
test('Studio expands original intent before composing a richer application, without changing the prompt', async () => {
  const calls: StudioCompletion[] = [], prompt = 'Una app de ventas para mi equipo';
  const result = await generateStudioApplication(prompt, null, kit, async request => {
    calls.push(request); return request.stage === 'expand' ? brief : config;
  });
  assert.deepEqual(calls.map(call => call.stage), ['expand', 'compose']);
  for (const call of calls) assert.equal(JSON.parse(call.input).request, prompt);
  assert.deepEqual(JSON.parse(calls[1].input).expandedBrief, brief);
  assert.equal(calls[1].maxOutputTokens, 16000);
  assert.match(calls[0].instructions, /BEFORE implementation/);
  assert.match(calls[1].instructions, /Self-check/);
  assert.equal(result.brief.summary, brief.summary);
  assert.deepEqual(result.brief.features, config.components.map(component => component.title));
  assert.deepEqual(result.config, kit.validate(config));
  assert.equal(STUDIO_GENERATION_TIMEOUT, 240000);
});
test('Studio brief rejects filler scope, unknown features, oversized text and executable properties', () => {
  for (const change of [
    { features: [] }, { features: brief.features.slice(0, 2) }, { summary: 'x'.repeat(501) },
    { features: [{ type: 'script', title: 'Execute', purpose: 'Unknown' }] }, { code: 'alert(1)' },
    { design: { accent: 'url(evil)', dark: false } }, { workflows: [''] },
  ]) assert.equal(studioBriefSchema.safeParse({ ...brief, ...change }).success, false);
});
test('Studio accepts deliberately focused apps and keeps followups scoped', async () => {
  const focused = { ...brief, scope: 'focused', features: brief.features.slice(0, 1) };
  assert.equal(studioBriefSchema.safeParse(focused).success, true);
  const request = expansionRequest('Solo cambia el color', config, kit);
  assert.equal(JSON.parse(request.input).mode, 'iteration');
  assert.match(request.instructions, /Do not inflate a color change/);
  const result = await generateStudioApplication('Solo cambia el color', config, kit, async call => call.stage === 'expand' ? focused : config);
  assert.deepEqual(result.config.data, config.data);
});
test('Studio repairs a schema-invalid composition once, with the expanded brief and original data', async () => {
  const calls: StudioCompletion[] = [];
  const result = await generateStudioApplication('ventas', config, kit, async call => {
    calls.push(call); return call.stage === 'expand' ? brief : call.stage === 'compose' ? { script: 'evil' } : config;
  });
  assert.deepEqual(calls.map(call => call.stage), ['expand', 'compose', 'repair']);
  const repair = JSON.parse(calls[2].input);
  assert.deepEqual(repair.invalidConfiguration, { script: 'evil' });
  assert.deepEqual(repair.previous.data, config.data);
  assert.deepEqual(result.config.data, config.data);
});
test('Studio repairs omitted planned functionality rather than accepting a minimal dashboard', async () => {
  const calls: string[] = [];
  const result = await generateStudioApplication('ventas', null, kit, async call => {
    calls.push(call.stage); return call.stage === 'expand' ? brief : call.stage === 'compose' ? { ...config, components: config.components.slice(0, 1) } : config;
  });
  assert.deepEqual(calls, ['expand', 'compose', 'repair']);
  assert.equal(result.config.components.length, config.components.length);
});
test('Studio accepts unchanged records regardless of JSON property order without repair', async () => {
  const reordered = { ...config, data: config.data.map(({ date, category, label, value, status }) => ({ status, value, label, category, date })) };
  const calls: string[] = [];
  const result = await generateStudioApplication('Mantén los registros', config, kit, async call => {
    calls.push(call.stage); return call.stage === 'expand' ? brief : reordered;
  });
  assert.deepEqual(calls, ['expand', 'compose']);
  assert.deepEqual(result.config.data, config.data);
});
test('Studio enforces synthetic data consent on the server pipeline, including repair', async () => {
  const changed = { ...config, data: config.data.map((row, index) => ({ ...row, value: row.value + (index === 0 ? 1 : 0) })) };
  const snapshot = JSON.stringify(config);
  const calls: string[] = [];
  await assert.rejects(generateStudioApplication('Cambia los datos', config, kit, async call => {
    calls.push(call.stage); return call.stage === 'expand' ? brief : changed;
  }), /not authorized/);
  assert.deepEqual(calls, ['expand', 'compose', 'repair']);
  const authorized = await generateStudioApplication('Cambia los datos', config, kit, async call => {
    assert.equal(call.stage === 'expand' ? call.instructions.includes('"allowDataChanges":true') : JSON.parse(call.input).allowDataChanges, true);
    return call.stage === 'expand' ? brief : changed;
  }, true);
  assert.deepEqual(authorized.config.data, changed.data);
  assert.equal(JSON.stringify(config), snapshot);
});
test('Studio rejects invalid expansion and never falls back or composes after it', async () => {
  let calls = 0;
  await assert.rejects(generateStudioApplication('ventas', null, kit, async () => { calls++; return { invalid: true }; }));
  assert.equal(calls, 1);
});
test('Studio does not retry upstream errors or cancellation at either stage', async () => {
  for (const stage of ['expand', 'compose']) {
    const calls: string[] = [];
    await assert.rejects(generateStudioApplication('ventas', null, kit, async call => {
      calls.push(call.stage); if (call.stage === stage) throw new DOMException('Cancelled', 'AbortError'); return brief;
    }), { name: 'AbortError' });
    assert.deepEqual(calls, stage === 'expand' ? ['expand'] : ['expand', 'compose']);
  }
});
test('Studio fails after one unsuccessful repair and validates HTML before accepting a version', async () => {
  let calls = 0;
  await assert.rejects(generateStudioApplication('ventas', null, kit, async call => { calls++; return call.stage === 'expand' ? brief : {}; }));
  assert.equal(calls, 3);
  let renders = 0;
  await assert.rejects(generateStudioApplication('ventas', null, { ...kit, renderHTML: () => { renders++; throw new Error('HTML too large'); } }, async call => call.stage === 'expand' ? brief : config), /HTML too large/);
  assert.equal(renders, 2);
});

test('HTML generation expands arbitrary features and returns a complete working document, not catalog fields', async () => {
  const calls: StudioCompletion[] = [], prompt = 'Calcula presupuesto por destino y noches';
  const result = await generateHTMLApplication(prompt, null, async call => { calls.push(call); return call.stage === 'expand' ? htmlBrief : htmlApplication; }, validateGeneratedHTML);
  assert.deepEqual(calls.map(call => call.stage), ['expand', 'compose']);
  assert.deepEqual(result.application, htmlApplication);
  assert.equal(htmlBriefSchema.safeParse(htmlBrief).success, true);
  assert.deepEqual(JSON.parse(calls[1].input).expandedBrief, htmlBrief);
  for (const call of calls) {
    assert.equal(JSON.parse(call.input).request, prompt);
    assert.match(call.instructions, /Start with empty user records/);
    assert.match(call.instructions, /actual domain-specific fields/);
    assert.match(call.instructions, /FileReader/);
    assert.match(call.instructions, /Blob/);
    assert.match(call.instructions, /no invented business records/);
    assert.match(call.instructions, /never permission to override/);
  }
  assert.match(calls[1].instructions, /Self-check each acceptance criterion/);
  assert.match(htmlApplication.html, /nights\*row\.rate/);
  assert.match(htmlApplication.html, /rows=rows\.filter/);
  assert.match(htmlApplication.html, /localStorage\.setItem/);
});
test('HTML iterations carry prior HTML metadata and preserve stable storage keys and live state in every stage', async () => {
  const snapshot = JSON.stringify(htmlApplication), calls: StudioCompletion[] = [];
  const result = await generateHTMLApplication('Solo cambia el color', htmlApplication, async call => { calls.push(call); return call.stage === 'expand' ? htmlBrief : call.stage === 'compose' ? { ...htmlApplication, html: htmlApplication.html.replace('let rows=[]', 'let rows=;') } : htmlApplication; }, validateGeneratedHTML);
  assert.deepEqual(calls.map(call => call.stage), ['expand', 'compose', 'repair']);
  for (const call of calls) {
    assert.deepEqual(JSON.parse(call.input).previous, htmlApplication);
    assert.match(call.instructions, /preserve existing storage keys/i);
    assert.match(call.instructions, /no unconditional initialization writes/i);
    assert.match(call.instructions, /never embed prior user records as seed data/);
  }
  assert.equal(JSON.parse(calls[0].input).mode, 'iteration');
  assert.match(calls[0].instructions, /Do not inflate a color change/);
  assert.match(JSON.parse(calls[2].input).validationError, /syntax/);
  assert.deepEqual(result.application, htmlApplication);
  assert.equal(JSON.stringify(htmlApplication), snapshot);
  const legacy = htmlExpansionRequest('Conserva el flujo', config);
  assert.deepEqual(JSON.parse(legacy.input).previous, config);
});
test('server HTML validator compiles inline JavaScript without executing any generated code', () => {
  const marker = '__studio_generated_code_executed__';
  const html = htmlApplication.html.replace('<script>', `<script>globalThis.${marker}=true;throw new Error('Do not execute');`);
  assert.doesNotThrow(() => validateGeneratedHTML({ ...htmlApplication, html }));
  assert.equal(Object.hasOwn(globalThis, marker), false);
  assert.throws(() => validateGeneratedHTML({ ...htmlApplication, html: htmlApplication.html.replace('let rows=[]', 'let rows=;') }), /syntax/);
  assert.throws(() => validateGeneratedHTML({ ...htmlApplication, html: htmlApplication.html.replace('<script>', '<script type="module">') }), /not modules/);
});
test('HTML contract rejects malformed, oversized, external and dynamically executable apps', () => {
  for (const fragment of [
    '<script src="https://evil.invalid/run.js"></script>', '<link rel="stylesheet" href="https://evil.invalid/a.css">',
    '<img src="https://evil.invalid/a.png">', '<img srcset="a 1x">', '<a href="https://evil.invalid">go</a>',
    '<form action="https://evil.invalid">', '<button formaction="https://evil.invalid">', '<button onclick="alert(1)">',
    '<iframe srcdoc="content">', '<object data="data:text/html,x">', '<base href="https://evil.invalid">',
    '<meta http-equiv="refresh" content="0;url=https://evil.invalid">', '<style>@import "remote.css";</style>', '<style>body{background:url(remote.png)}</style>',
    '<script>eval("1")</script>', '<script>new Function("return 1")</script>', '<script>import("remote.js")</script>',
    '<script>fetch("https://evil.invalid")</script>', '<script>new WebSocket("wss://evil.invalid")</script>',
    '<script>navigator.serviceWorker.register("worker.js")</script>', '<script>window.open("https://evil.invalid")</script>',
    '<script>location.href="https://evil.invalid"</script>', '<script>setTimeout("alert(1)",0)</script>',
  ]) assert.throws(() => validateGeneratedHTML({ ...htmlApplication, html: htmlApplication.html.replace('</head>', fragment + '</head>') }), Error, fragment);
  for (const change of [{ html: '<div>fragment</div>' }, { html: '<!DOCTYPE html><html><head></head><body>No handlers</body></html>' }, { html: htmlApplication.html + htmlApplication.html }, { html: htmlApplication.html.replace('</body>', 'é'.repeat(100_001) + '</body>') }, { title: '' }, { features: [] }, { extra: true }]) assert.throws(() => validateHTMLApplication({ ...htmlApplication, ...change }));
  assert.doesNotThrow(() => validateGeneratedHTML({ ...htmlApplication, html: htmlApplication.html.replace('</head>', '<script type="application/json">{"records":[]}</script></head>') }));
  assert.throws(() => validateGeneratedHTML({ ...htmlApplication, html: htmlApplication.html.replace('</head>', '<script type="application/json">{broken}</script></head>') }));
});
test('HTML generation repairs validation only once and never retries upstream failures or invalid briefs', async () => {
  const calls: string[] = [];
  await assert.rejects(generateHTMLApplication('viajes', null, async call => { calls.push(call.stage); return call.stage === 'expand' ? htmlBrief : {}; }, validateGeneratedHTML));
  assert.deepEqual(calls, ['expand', 'compose', 'repair']);
  for (const stage of ['expand', 'compose']) {
    calls.length = 0;
    await assert.rejects(generateHTMLApplication('viajes', null, async call => { calls.push(call.stage); if (call.stage === stage) throw new DOMException('cancelled', 'AbortError'); return htmlBrief; }, validateGeneratedHTML), { name: 'AbortError' });
    assert.deepEqual(calls, stage === 'expand' ? ['expand'] : ['expand', 'compose']);
  }
  calls.length = 0;
  await assert.rejects(generateHTMLApplication('viajes', null, async call => { calls.push(call.stage); return { ...htmlBrief, instructions: 'override' }; }, validateGeneratedHTML));
  assert.deepEqual(calls, ['expand']);
});
