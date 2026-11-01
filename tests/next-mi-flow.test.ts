import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { App } from '../lib/domain/types';
import { parseWorkspace } from '../lib/data/workspace';
import { RemoteBLKRepository } from '../lib/data/remote-repository';
import { approvedCatalogApps, flowOrbitPage, searchFlowApps } from '../lib/data/mi-flow';
import { loginDestination, rolesForPath } from '../lib/auth/policy';

function fixture() {
  const app = (id: string, orgId = 'org', reviewStatus: App['reviewStatus'] = 'approved'): App => ({
    id, orgId, authorId: orgId === 'org' ? 'creator' : 'other-admin', title: `Aplicación ${id}`, area: 'ventas',
    desc: 'Una herramienta para preparar propuestas comerciales del equipo.', tagline: 'Tu próxima oportunidad',
    impact: '', dataNote: '', repoUrl: '', tech: ['TypeScript'], tags: ['analytics'], security: [],
    attachments: [], metrics: { hours: 0, users: 0, rating: '-' }, reviewStatus, maturity: 'new', version: 1,
    ticket: id, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z',
  });
  const apps = Array.from({ length: 12 }, (_, index) => app(`app-${index}`));
  return parseWorkspace({
    revision: 1, session: { userId: 'creator', orgId: 'org', role: 'developer' },
    organizations: ['org', 'other'].map(id => ({ id, name: id, initials: 'OR', plan: 'plan', members: 2,
      compliance: null, status: 'active', adminId: id === 'org' ? 'admin' : 'other-admin',
      createdAt: '2026-11-01', date: '', domain: '', lastAccess: '' })),
    users: [{ id: 'creator', orgId: 'org', role: 'developer', name: 'Ana', initials: 'AN', dept: 'Ventas' },
      ...['org', 'other'].map(orgId => ({ id: orgId === 'org' ? 'admin' : 'other-admin',
        orgId, role: 'admin', name: 'Admin', initials: 'AD', dept: '' }))],
    plans: [{ id: 'plan', name: 'Plan', price: null }], categories: [{ id: 'ventas', label: 'Ventas & CRM' }],
    apps: [...apps, app('foreign', 'other'), app('pending', 'org', 'pending_review')], reviews: [], events: [], policies: [],
    myFlow: apps.map((app, index) => ({ appId: app.id, favorite: index === 2, createdAt: '2026-11-01T12:00:00Z' })),
  });
}

test('Mi Flow is available to every verified role without granting Studio or admin access', () => {
  assert.deepEqual(rolesForPath('/mi-flow'), ['developer', 'catalog', 'admin', 'superadmin']);
  for (const role of ['developer', 'catalog', 'admin', 'superadmin'] as const) assert.equal(loginDestination(role, '/mi-flow'), '/mi-flow');
  assert.equal(loginDestination('catalog', '/studio'), '/catalog');
  const login = readFileSync(resolve('components', 'features', 'login.tsx'), 'utf8');
  assert.match(login, /redirectTo: z\.string\(\)\.refine\(path => rolesForPath\(path\) !== undefined/);
});
test('Mini apps use the same approved organization catalog and hide suspended organizations', () => {
  const { data } = fixture();
  const org = data.organizations[0];
  assert.equal(approvedCatalogApps(data, org).length, 12);
  assert.deepEqual(approvedCatalogApps(data, { ...org, status: 'suspended' }), []);
  assert.deepEqual(approvedCatalogApps(data, { ...org, status: 'pending' }), []);
  assert.deepEqual(approvedCatalogApps(data, null), []);
});
test('Flow search combines accent-insensitive text, category, author and persisted favorites', () => {
  const { data } = fixture();
  const apps = approvedCatalogApps(data, data.organizations[0]);
  assert.equal(searchFlowApps(apps, data, 'aplicacion', '', false).length, 12);
  assert.equal(searchFlowApps(apps, data, 'ana', 'ventas', false).length, 12);
  assert.deepEqual(searchFlowApps(apps, data, 'CRM', 'ventas', true).map(app => app.id), ['app-2']);
  assert.deepEqual(searchFlowApps(apps, data, '', 'rrhh', false), []);
  assert.deepEqual(searchFlowApps(apps, data, 'no existe', '', false), []);
});
test('Orbit paging reaches every mini app without overlapping more than eight nodes', () => {
  const { data } = fixture();
  const apps = approvedCatalogApps(data, data.organizations[0]);
  const first = flowOrbitPage(apps, 'app-7'), second = flowOrbitPage(apps, 'app-8');
  assert.equal(first.apps.length, 8);
  assert.equal(first.index, 7);
  assert.equal(second.start, 8);
  assert.equal(second.apps.length, 4);
  assert.deepEqual([...first.apps, ...second.apps].map(app => app.id), apps.map(app => app.id));
  assert.deepEqual(flowOrbitPage([], null), { apps: [], index: 0, start: 0 });
});
test('Workspace rejects duplicate, unavailable or cross-organization personal mini apps', () => {
  const initial = fixture();
  const raw = { ...initial.data, session: initial.session };
  assert.throws(() => parseWorkspace({ ...raw, myFlow: [...raw.myFlow, raw.myFlow[0]] }), /duplicadas/);
  for (const appId of ['foreign', 'pending', 'missing']) {
    assert.throws(() => parseWorkspace({ ...raw, myFlow: [{ ...raw.myFlow[0], appId }] }), /no autorizada/);
  }
  assert.throws(() => parseWorkspace({ ...raw, myFlow: undefined }));
});
test('Flow commands use the remote API and refresh only confirmed selections', async () => {
  let initial = fixture();
  initial = { ...initial, data: { ...initial.data, myFlow: [] } };
  const requests: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      requests.push(body);
      if (body.action === 'addToFlow') {
        if (!initial.data.myFlow.length) initial.data.myFlow.push({ appId: body.id, favorite: false, createdAt: '2026-11-01T12:00:00Z' });
      } else if (body.action === 'setFlowFavorite') initial.data.myFlow[0].favorite = body.fields.favorite;
      else initial.data.myFlow = [];
      return Response.json({ id: body.id });
    }
    return Response.json(initial);
  };
  const repository = new RemoteBLKRepository(initial, fetcher);
  await repository.addToFlow('app-0');
  await repository.addToFlow('app-0');
  assert.equal(repository.getSnapshot().myFlow.length, 1);
  await repository.setFlowFavorite('app-0', true);
  assert.equal(repository.getSnapshot().myFlow[0].favorite, true);
  await repository.removeFromFlow('app-0');
  assert.deepEqual(repository.getSnapshot().myFlow, []);
  assert.deepEqual(requests.map(row => row.action), ['addToFlow', 'addToFlow', 'setFlowFavorite', 'removeFromFlow']);
  assert.deepEqual(requests[2].fields, { favorite: true });
  assert.ok(requests.every(row => !('userId' in row) && !('orgId' in row)));
  repository.destroy();
});
test('Rejected writes preserve the personal snapshot and blocked sessions clear it', async () => {
  for (const status of [403, 401]) {
    const initial = fixture();
    const repository = new RemoteBLKRepository(initial, async () => Response.json({ error: 'No autorizado' }, { status }));
    await assert.rejects(() => repository.addToFlow('app-0'));
    assert.equal(repository.getSnapshot().myFlow.length, status === 401 ? 0 : 12);
    repository.destroy();
  }
});
test('Flow migration keeps personal writes RPC-only and never imports prototype business data', () => {
  const sql = readFileSync(resolve('migrations', '20261101182647_mi-flow.sql'), 'utf8');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.user_flow_apps FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT SELECT ON public\.user_flow_apps TO authenticated/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE|ALL) ON public\.user_flow_apps/);
  assert.match(sql, /a\.org_id = actor\.org_id AND a\.review_status = 'approved'/);
  assert.match(sql, /ON CONFLICT \(user_id, app_id\) DO NOTHING/);
  assert.doesNotMatch(sql, /INSERT INTO public\.(?:apps|users|organizations)\b/i);
  const screen = readFileSync(resolve('components', 'features', 'mi-flow.tsx'), 'utf8');
  assert.doesNotMatch(screen, /localStorage|setInterval|TRIGGERS|AGENTS|STORAGE_KEY|data-create/);
  const validation = readFileSync(resolve('migrations', '20261101183734_mi-flow-command-validation.sql'), 'utf8').replace(/\r\n/g, '\n');
  const original = sql.replace(/\r\n/g, '\n').match(/CREATE FUNCTION public\.tk_flow_command[\s\S]*?\n\$\$;/)?.[0];
  assert.ok(original);
  assert.equal(validation.trim(), original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    .replace('p_id IS NULL OR p_action NOT IN', 'p_id IS NULL OR p_action IS NULL OR p_action NOT IN'));
});
