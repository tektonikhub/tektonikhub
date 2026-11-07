import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { expansionRequest, generateStudioApplication, STUDIO_GENERATION_TIMEOUT, studioBriefSchema, type StudioCompletion } from '../lib/studio/generation';
import type { DashboardKit } from '../lib/studio/types';
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
  assert.equal(STUDIO_GENERATION_TIMEOUT, 60000);
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
