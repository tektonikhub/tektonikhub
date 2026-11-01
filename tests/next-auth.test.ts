import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { destinations, identifierSchema, loginDestination, loginSchema, newPasswordSchema, rolesForPath, trustedOrigin, validResetLink } from '../lib/auth/policy';
import { ApiError } from '../lib/data/http-client';
import { RemoteBLKRepository } from '../lib/data/remote-repository';
import { parseWorkspace, type WorkspaceState } from '../lib/data/workspace';

test('Login normalizes email and username without accepting role or organization overrides', () => {
  assert.equal(identifierSchema.parse('  Alice.Example@EXAMPLE.COM  '), 'alice.example@example.com');
  assert.equal(identifierSchema.parse('  Alice.Example_1  '), 'alice.example_1');
  for (const identifier of ['', 'ab', 'a b', '@example.com', 'alice@example', 'alice/other']) {
    assert.equal(identifierSchema.safeParse(identifier).success, false, identifier);
  }
  const input = { identifier: 'alice', password: 'password with spaces ' };
  assert.equal(loginSchema.parse(input).password, input.password);
  for (const override of [{ role: 'superadmin' }, { orgId: 'another-company' }]) {
    assert.equal(loginSchema.safeParse({ ...input, ...override }).success, false);
  }
});

test('Post-login destinations are internal and enforce server-assigned roles', () => {
  for (const role of ['developer', 'catalog', 'admin', 'superadmin'] as const) {
    assert.equal(loginDestination(role, undefined), destinations[role]);
    for (const unsafe of ['https://example.invalid', '//example.invalid', '/\\example.invalid', '/login', '/admin?role=superadmin', '/profile#admin']) {
      assert.equal(loginDestination(role, unsafe), destinations[role], unsafe);
    }
    assert.equal(loginDestination(role, '/company'), '/company');
  }
  for (const role of ['developer', 'admin', 'superadmin'] as const) {
    assert.equal(loginDestination(role, '/studio'), '/studio');
  }
  assert.equal(loginDestination('catalog', '/studio'), '/catalog');
  assert.equal(loginDestination('developer', '/admin'), '/profile');
  assert.equal(loginDestination('admin', '/super-admin'), '/admin');
  assert.equal(loginDestination('superadmin', '/admin'), '/admin');
  assert.deepEqual(rolesForPath('/studio'), ['developer', 'admin', 'superadmin']);
  assert.equal(rolesForPath('/unrecognized'), undefined);
});

test('Studio migration broadens only creator roles and preserves every existing command guard', () => {
  const pattern = /CREATE(?: OR REPLACE)? FUNCTION public\.tk_command\([\s\S]*?\n\$\$;/;
  const original = readFileSync(resolve('migrations', '20261101075915_identity-workspace.sql'), 'utf8').replace(/\r\n/g, '\n').match(pattern)?.[0];
  const migration = readFileSync(resolve('migrations', '20261101180821_studio-admin-access.sql'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(original);
  const expected = original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    .replace("actor.role <> 'developer'", "actor.role NOT IN ('developer', 'admin', 'superadmin')")
    .replace("u.role = 'developer'", "u.role IN ('developer', 'admin', 'superadmin')");
  assert.equal(migration.trim(), expected);
});

test('Auth mutations require the configured origin, with narrowly scoped development origins', () => {
  const app = 'https://portal.example.invalid';
  assert.equal(trustedOrigin(app, app), true);
  for (const origin of [null, 'null', 'http://portal.example.invalid', `${app}/`, `${app}/login`, 'https://example.invalid', 'https://portal.example.invalid.attacker.invalid']) {
    assert.equal(trustedOrigin(origin, app), false, String(origin));
  }
  assert.equal(trustedOrigin('http://127.0.0.1:3000', app, true), true);
  assert.equal(trustedOrigin('http://localhost:3000', app, true), true);
  assert.equal(trustedOrigin('http://localhost:3001', app, true), false);
  assert.equal(trustedOrigin('http://localhost:3000', app), false);
});

test('Password reset accepts only complete InsForge reset links and enforces password bounds', () => {
  const valid = new URLSearchParams({ insforge_status: 'ready', insforge_type: 'reset_password', token: 'synthetic-single-use-token' });
  assert.equal(validResetLink(valid), 'synthetic-single-use-token');
  const invalidLinks: Record<string, string>[] = [{ insforge_status: 'failed' }, { insforge_type: 'verify_email' }, { token: '' }, { token: 'bad\nvalue' }, { token: 'x'.repeat(4097) }];
  for (const changes of invalidLinks) {
    assert.equal(validResetLink(new URLSearchParams({ ...Object.fromEntries(valid), ...changes })), null);
  }
  assert.equal(newPasswordSchema.safeParse('x'.repeat(14)).success, false);
  assert.equal(newPasswordSchema.safeParse('x'.repeat(15)).success, true);
  assert.equal(newPasswordSchema.safeParse('x'.repeat(129)).success, false);
});

function workspace(): WorkspaceState {
  return parseWorkspace({
    revision: 0,
    session: { userId: 'test-developer', orgId: 'test-org', role: 'developer' },
    users: [
      { id: 'test-developer', orgId: 'test-org', role: 'developer', name: 'Test developer', initials: 'TD', dept: 'Testing' },
      { id: 'test-admin', orgId: 'test-org', role: 'admin', name: 'Test admin', initials: 'TA', dept: 'Testing' },
    ],
    organizations: [{ id: 'test-org', name: 'Test organization', initials: 'TO', plan: 'test-plan', members: 2, compliance: null,
      status: 'active', adminId: 'test-admin', createdAt: '2026-01-01', date: '2026-01-01', domain: '', lastAccess: '' }],
    plans: [{ id: 'test-plan', name: 'Test plan', price: null }],
    apps: [], reviews: [], events: [], policies: [], categories: [],
  });
}

test('Unauthorized and blocked remote sessions discard private snapshots instead of using demo storage', async () => {
  for (const [status, code] of [[401, undefined], [403, 'ACCOUNT_BLOCKED']] as const) {
    const fetcher: typeof fetch = async () => Response.json({ error: 'Account unavailable', code }, { status });
    const repository = new RemoteBLKRepository(workspace(), fetcher);
    let changes = 0;
    repository.subscribe(() => { changes += 1; });
    await assert.rejects(() => repository.refresh(), ApiError);
    assert.equal(repository.getSession(), null);
    assert.equal(repository.getSnapshot().users.length, 0);
    assert.equal(repository.getSnapshot().organizations.length, 0);
    assert.equal(repository.getSnapshot().apps.length, 0);
    assert.equal(changes, 1);
    repository.destroy();
  }
});

test('Transient backend failures do not revoke the cached authorized identity', async () => {
  const initial = workspace();
  const fetcher: typeof fetch = async () => Response.json({ error: 'Service unavailable' }, { status: 503 });
  const repository = new RemoteBLKRepository(initial, fetcher);
  await assert.rejects(() => repository.refresh(), ApiError);
  assert.deepEqual(repository.getSession(), initial.session);
  assert.ok(repository.getSnapshot().users.length);
  repository.destroy();
});

test('An unconfirmed logout reports its failure without pretending the session was closed', async () => {
  const initial = workspace();
  const fetcher: typeof fetch = async () => { throw new TypeError('Synthetic connection failure'); };
  const repository = new RemoteBLKRepository(initial, fetcher);
  await assert.rejects(() => repository.clearSession(), ApiError);
  assert.deepEqual(repository.getSession(), initial.session);
  assert.ok(repository.getSnapshot().users.length);
  repository.destroy();
});

test('A confirmed logout clears the remote identity and private data exactly once', async () => {
  const fetcher: typeof fetch = async () => Response.json({ signedOut: true });
  const repository = new RemoteBLKRepository(workspace(), fetcher);
  let changes = 0;
  repository.subscribe(() => { changes += 1; });
  await repository.clearSession();
  assert.equal(repository.getSession(), null);
  assert.equal(repository.getSnapshot().users.length, 0);
  assert.equal(changes, 1);
  repository.destroy();
});

test('Bootstrap help runs standalone with no credentials, cookie request context or database writes', () => {
  const output = execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', resolve('scripts', 'bootstrap-insforge.mts'), '--help'], { encoding: 'utf8' });
  assert.match(output, /accounts:bootstrap/);
  assert.match(output, /--resend/);
});
