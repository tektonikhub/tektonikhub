'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { randomBytes, createHmac } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const roles = ['developer', 'catalog', 'admin', 'superadmin'];
const destinations = { developer: '/profile', catalog: '/catalog', admin: '/admin', superadmin: '/super-admin' };
const password = 'Synthetic login password 123';
const orgId = '00000000-0000-4000-8000-000000000001';
const planId = '00000000-0000-4000-8000-000000000002';
const accounts = roles.map((role, index) => ({
  role, id: `00000000-0000-4000-8000-00000000010${index}`,
  authId: `00000000-0000-4000-8000-00000000020${index}`,
  username: role, email: `${role}@example.invalid`, password, verified: true, enabled: true,
}));
const state = { empty: false, throttleDenied: false, authStatus: 200, refreshStatus: 200, signupStatus: 200, reserved: false, created: false, invitation: '', resetToken: 'synthetic-reset-token' };
const counts = { login: 0, refresh: 0, bootstrap: 0, signup: 0, verify: 0 };
const accessTokens = new Map(), refreshTokens = new Map();
const signingKey = randomBytes(32);
let base, environment, next, browser, logs = '';
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function jwt(account, seconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: account.authId, exp: Math.floor(Date.now() / 1000) + seconds, jti: randomBytes(8).toString('hex') })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')}`;
}
function user(account) {
  return { id: account.authId, email: account.email, emailVerified: account.verified, isAnonymous: false, profile: { name: `Synthetic ${account.role}` } };
}
function identity(account) { return { userId: account.id, orgId, role: account.role }; }
function issue(account) {
  const accessToken = jwt(account, 3600), refreshToken = jwt(account, 2592000);
  accessTokens.set(accessToken, account); refreshTokens.set(refreshToken, account);
  return { accessToken, refreshToken, user: user(account) };
}
function workspace(account) {
  return {
    session: identity(account), revision: 0,
    categories: [{ id: 'operations', label: 'Operations' }],
    organizations: [{ id: orgId, name: 'Synthetic organization', initials: 'SO', plan: planId, members: 4, compliance: null, status: 'active',
      adminId: accounts[2].id, createdAt: '2026-01-01T00:00:00.000Z', date: '2026-01-01', domain: '', lastAccess: '', system: true }],
    users: accounts.map(value => ({ id: value.id, orgId, role: value.role, name: `Synthetic ${value.role}`, initials: 'ST', dept: 'Testing',
      email: value.email, username: value.username, enabled: value.enabled, accountStatus: 'active', deletedAt: null })),
    plans: [{ id: planId, name: 'Initial', price: 0 }], apps: [], reviews: [], events: [], policies: [],
  };
}
function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function fail(response, status) { send(response, status, { statusCode: status, error: status === 401 ? 'AUTH_UNAUTHORIZED' : 'AUTH_ERROR', message: 'Synthetic backend error' }); }

const backend = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : {};
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    const account = accessTokens.get(token);
    if (url.pathname === '/api/database/records/users') {
      assert.equal(token, environment.INSFORGE_API_KEY);
      if (state.empty) return send(response, 200, []);
      const select = url.searchParams.get('select');
      if (url.searchParams.get('role') === 'eq.superadmin') {
        return send(response, 200, state.reserved ? [{ id: accounts[3].id, email: accounts[3].email, username: accounts[3].username }] : []);
      }
      if (select === 'id') return send(response, 200, [{ id: accounts[0].id }]);
      const identifier = (url.searchParams.get('email_key') || url.searchParams.get('username_key') || '').replace(/^eq\./, '');
      const value = accounts.find(value => value.email === identifier || value.username === identifier);
      return send(response, 200, value ? [{ email: value.email }] : []);
    }
    if (url.pathname === '/api/database/rpc/tk_auth_throttle') {
      assert.equal(token, environment.INSFORGE_API_KEY);
      assert.match(body.p_key, /^[0-9a-f]{64}$/);
      return send(response, 200, !state.throttleDenied);
    }
    if (url.pathname === '/api/database/rpc/tk_identity') return send(response, 200, account?.enabled && account.verified ? identity(account) : null);
    if (url.pathname === '/api/database/rpc/tk_workspace') {
      if (!account?.enabled || !account.verified) return fail(response, 401);
      return send(response, 200, workspace(account));
    }
    if (url.pathname === '/api/auth/sessions') {
      counts.login += 1;
      if (state.authStatus !== 200) return fail(response, state.authStatus);
      const target = accounts.find(value => value.email === body.email && value.password === body.password);
      if (!target) return fail(response, 401);
      if (!target.verified) return fail(response, 403);
      return send(response, 200, issue(target));
    }
    if (url.pathname === '/api/auth/sessions/current') return account ? send(response, 200, { user: user(account) }) : fail(response, 401);
    if (url.pathname === '/api/auth/refresh') {
      counts.refresh += 1;
      if (state.refreshStatus !== 200) return fail(response, state.refreshStatus);
      const target = refreshTokens.get(body.refreshToken || body.refresh_token);
      if (!target) return fail(response, 401);
      return send(response, 200, issue(target));
    }
    if (url.pathname === '/api/auth/logout') return send(response, 200, { success: true });
    if (url.pathname === '/api/auth/email/send-reset-password' || url.pathname === '/api/auth/email/send-verification') {
      if (url.pathname.endsWith('send-verification')) counts.verify += 1;
      assert.ok(body.redirectTo.startsWith(base + '/reset-password'));
      return send(response, 200, { success: true });
    }
    if (url.pathname === '/api/auth/email/reset-password') {
      if (body.otp !== state.resetToken) return fail(response, 400);
      accounts[0].password = body.newPassword;
      state.resetToken = null;
      return send(response, 200, { success: true });
    }
    if (url.pathname === '/api/database/rpc/tk_bootstrap') {
      assert.equal(token, environment.INSFORGE_API_KEY);
      counts.bootstrap += 1;
      assert.equal(state.reserved, false);
      assert.equal(body.p_email, accounts[3].email);
      assert.equal(body.p_username, accounts[3].username);
      state.reserved = true; state.empty = false;
      return send(response, 200, { userId: accounts[3].id, orgId });
    }
    if (url.pathname === '/api/database/rpc/tk_invitation_target') {
      assert.equal(token, environment.INSFORGE_API_KEY);
      return send(response, 200, { email: accounts[3].email, name: 'Synthetic administrator', authUserId: state.created ? accounts[3].authId : null, verified: false });
    }
    if (url.pathname === '/api/database/rpc/tk_mark_invitation') {
      assert.equal(token, environment.INSFORGE_API_KEY);
      state.invitation = body.p_state;
      return send(response, 200, null);
    }
    if (url.pathname === '/api/auth/users') {
      assert.equal(token, environment.INSFORGE_API_KEY);
      counts.signup += 1;
      if (state.signupStatus !== 200) return fail(response, state.signupStatus);
      assert.equal(body.email, accounts[3].email);
      assert.ok(body.password.length >= 15);
      assert.ok(body.redirectTo.startsWith(base + '/reset-password'));
      state.created = true;
      return send(response, 200, { user: user(accounts[3]), requireEmailVerification: true, verifyEmailMethod: 'link' });
    }
    throw new Error(`Unexpected mock endpoint ${request.method} ${url.pathname}`);
  } catch (error) {
    logs += `\nMock backend: ${error.message}`;
    send(response, 500, { statusCode: 500, error: 'MOCK_ERROR', message: error.message });
  }
});

async function availablePort() {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
function stopOwnedTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const script = `function Stop-Owned([int]$processId) { Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" | ForEach-Object { Stop-Owned $_.ProcessId }; Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }; Stop-Owned ${child.pid}`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
async function context() {
  const result = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await result.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return result;
}
async function post(page, endpoint, body, origin = base) {
  return page.evaluate(async ({ endpoint, body, origin }) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookies: response.headers.get('set-cookie') };
  }, { endpoint, body, origin });
}
async function session(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    return { status: response.status, body: await response.json() };
  });
}
async function login(page, role, nextPath = '', value = accounts.find(value => value.role === role).password) {
  await page.goto(base + '/login' + (nextPath ? '?next=' + encodeURIComponent(nextPath) : ''));
  await page.getByLabel('Usuario o correo electrónico').fill(role);
  await page.getByLabel('Contraseña', { exact: true }).fill(value);
  let resolveResponse, rejectResponse;
  const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
  const handler = async route => {
    try {
      const result = await route.fetch();
      const body = await result.json();
      await route.fulfill({ response: result });
      resolveResponse({ status: result.status(), body });
    } catch (error) { rejectResponse(error); await route.abort(); }
  };
  await page.route('**/api/auth/login', handler);
  try {
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const result = await response;
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(Object.keys(result.body), ['redirectTo']);
    await page.waitForURL(base + result.body.redirectTo);
    await page.locator('#main-content').waitFor();
    return result.body.redirectTo;
  } finally { await page.unroute('**/api/auth/login', handler); }
}
async function removeAccess(ctx) {
  const refresh = (await ctx.cookies()).find(cookie => cookie.name === 'insforge_refresh_token');
  assert.ok(refresh, 'Refresh cookie must exist');
  await ctx.clearCookies({ name: 'insforge_access_token' });
  return refresh;
}
async function run(name, operation) {
  await operation();
  console.log('PASS: ' + name);
}
async function bootstrap(resend = false) {
  const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', path.join(root, 'scripts', 'bootstrap-insforge.mts'),
    accounts[3].email, accounts[3].username, ...(resend ? ['--resend'] : [])], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  return { status, output };
}
async function main() {
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  try {
    base = `http://127.0.0.1:${await availablePort()}`;
    environment = {
      ...process.env, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', BLK_ENABLE_LOCAL_LLM: 'false',
      NEXT_PUBLIC_INSFORGE_URL: `http://127.0.0.1:${backend.address().port}`, NEXT_PUBLIC_INSFORGE_ANON_KEY: 'synthetic-anon-key',
      INSFORGE_API_KEY: 'synthetic-admin-key', APP_URL: base, NEXT_PUBLIC_APP_URL: base,
    };
    next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', new URL(base).port],
      { cwd: root, env: environment, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const append = value => { logs = (logs + value.toString()).slice(-16000); };
    next.stdout.on('data', append); next.stderr.on('data', append);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (next.exitCode !== null) throw new Error(`Next exited: ${logs}`);
      try { if ((await fetch(base + '/login', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } }
      catch (error) { if (!['TimeoutError', 'TypeError'].includes(error.name)) throw error; }
      await wait(500);
    }
    assert.ok(ready, `Next not ready: ${logs}`);
    browser = await chromium.launch({ headless: true });
    await run('Empty backend explains initial setup instead of pretending credentials can work', async () => {
      state.empty = true;
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await page.goto(base + '/login');
        await page.getByText(/todavía no tiene cuentas autorizadas/).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Entrar', exact: true }).isDisabled(), true);
      } finally { state.empty = false; await ctx.close(); }
    });
    await run('Guest guards preserve destination; forged browser demo identity does not grant access', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await page.goto(base + '/login?role=superadmin');
        await page.evaluate(() => sessionStorage.setItem('blkunit:demo-session:v1', JSON.stringify({ role: 'superadmin', userId: 'forged', orgId: 'forged' })));
        for (const destination of ['/catalog', '/profile', '/company', '/studio', '/admin', '/super-admin']) {
          await page.goto(base + destination);
          await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('next') === destination);
        }
        assert.equal((await session(page)).status, 401);
        const invalid = await post(page, '/api/auth/login', { identifier: 'a b', password });
        assert.equal(invalid.status, 400);
        const wrong = await post(page, '/api/auth/login', { identifier: 'developer', password: 'incorrect' });
        const unknown = await post(page, '/api/auth/login', { identifier: 'unknown', password: 'incorrect' });
        assert.equal(wrong.status, 401); assert.deepEqual(unknown.body, wrong.body);
        assert.equal((await ctx.cookies()).some(value => value.name.startsWith('insforge_')), false);
      } finally { await ctx.close(); }
    });
    await run('All four real role flows set secure session boundaries, survive reload and deny privileged destinations', async () => {
      for (const role of roles) {
        const ctx = await context();
        try {
          const page = await ctx.newPage();
          assert.equal(await login(page, role, 'https://example.invalid'), destinations[role]);
          const cookies = await ctx.cookies();
          const refresh = cookies.find(value => value.name === 'insforge_refresh_token');
          assert.ok(refresh?.httpOnly); assert.equal(refresh.sameSite, 'Lax'); assert.ok(refresh.expires > Date.now() / 1000);
          assert.equal(cookies.find(value => value.name === 'insforge_access_token')?.httpOnly, false);
          await page.reload(); assert.equal((await session(page)).body.role, role);
          await page.goto(base + '/login?next=%2Fcompany'); await page.waitForURL(base + '/company');
          if (role !== 'superadmin') { await page.goto(base + '/super-admin'); await page.waitForURL(base + destinations[role]); }
          if (role === 'catalog' || role === 'developer') { await page.goto(base + '/admin'); await page.waitForURL(base + destinations[role]); }
        } finally { await ctx.close(); }
      }
    });
    await run('Proxy forwards freshly refreshed cookies and the explicit refresh route rotates only once', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'developer', '/company');
        const original = await removeAccess(ctx), before = counts.refresh;
        await page.goto(base + '/profile'); await page.waitForURL(base + '/profile');
        assert.equal((await session(page)).status, 200); assert.equal(counts.refresh, before + 1);
        const renewed = (await ctx.cookies()).find(value => value.name === 'insforge_refresh_token');
        assert.notEqual(renewed.value, original.value);
        await removeAccess(ctx);
        const previous = counts.refresh;
        const result = await post(page, '/api/auth/refresh', {});
        assert.equal(result.status, 200); assert.equal(counts.refresh, previous + 1);
        assert.equal('refreshToken' in result.body, false);
        assert.equal((await session(page)).status, 200);
      } finally { await ctx.close(); }
    });
    await run('Temporary refresh failures keep the httpOnly cookie; invalid refresh credentials clear it', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'developer');
        const refresh = await removeAccess(ctx);
        state.refreshStatus = 503;
        assert.equal((await session(page)).status, 503);
        assert.equal((await ctx.cookies()).find(value => value.name === 'insforge_refresh_token').value, refresh.value);
        assert.equal((await post(page, '/api/auth/refresh', {})).status, 503);
        assert.equal((await ctx.cookies()).find(value => value.name === 'insforge_refresh_token').value, refresh.value);
        state.refreshStatus = 200;
        assert.equal((await session(page)).status, 200);
        await removeAccess(ctx);
        await ctx.addCookies([{ name: 'insforge_refresh_token', value: 'invalid-refresh-token', url: base, httpOnly: true, sameSite: 'Lax' }]);
        assert.equal((await session(page)).status, 401);
        assert.equal((await ctx.cookies()).some(value => value.name.startsWith('insforge_')), false);
      } finally { state.refreshStatus = 200; await ctx.close(); }
    });
    await run('Logout clears shared cookies and returns both tabs to credential-based login', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'developer');
        const other = await ctx.newPage(); await other.goto(base + '/profile'); await other.locator('#main-content').waitFor();
        await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/login');
        await other.waitForURL(url => url.pathname === '/login');
        assert.equal((await session(page)).status, 401);
        assert.equal((await ctx.cookies()).some(value => value.name.startsWith('insforge_')), false);
      } finally { await ctx.close(); }
    });
    await run('Unverified/disabled identities and rate limits never produce successful login responses', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await page.goto(base + '/login');
        accounts[0].verified = false;
        assert.equal((await post(page, '/api/auth/login', { identifier: 'developer', password })).status, 401);
        accounts[0].verified = true; accounts[0].enabled = false;
        assert.equal((await post(page, '/api/auth/login', { identifier: 'developer', password })).status, 401);
        assert.equal((await ctx.cookies()).some(value => value.name.startsWith('insforge_')), false);
        accounts[0].enabled = true; state.authStatus = 503;
        assert.equal((await post(page, '/api/auth/login', { identifier: 'developer', password })).status, 503);
        state.authStatus = 429;
        assert.equal((await post(page, '/api/auth/login', { identifier: 'developer', password })).status, 429);
        state.authStatus = 200; state.throttleDenied = true;
        const before = counts.login;
        assert.equal((await post(page, '/api/auth/login', { identifier: 'developer', password })).status, 429);
        assert.equal(counts.login, before);
        state.throttleDenied = false;
        const denied = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'developer', password }) });
        assert.equal(denied.status, 403);
      } finally { accounts[0].verified = true; accounts[0].enabled = true; state.authStatus = 200; state.throttleDenied = false; await ctx.close(); }
    });
    await run('Password links are scrubbed, password rules enforced and the new password signs in', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage();
        await page.goto(base + '/reset-password?insforge_status=ready&insforge_type=reset_password&token=synthetic-reset-token');
        await page.getByLabel('Nueva contraseña', { exact: true }).waitFor();
        await page.waitForURL(base + '/reset-password');
        const newPassword = 'A new synthetic password 456';
        await page.getByLabel('Nueva contraseña', { exact: true }).fill(newPassword);
        await page.getByLabel('Repetir contraseña').fill(newPassword);
        await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/login' && url.searchParams.get('password') === 'updated');
        await page.getByText(/Contraseña guardada/).waitFor();
        assert.equal((await post(page, '/api/auth/login', { identifier: 'developer', password })).status, 401);
        await login(page, 'developer', '', newPassword);
        await page.goto(base + '/reset-password');
        assert.equal((await post(page, '/api/auth/reset-password', { token: 'used-token', password: 'short' })).status, 400);
        assert.equal((await post(page, '/api/auth/reset-password', { token: 'used-token', password: newPassword })).status, 400);
      } finally { await ctx.close(); }
    });
    await run('First-account CLI loads env safely, preserves a failed reservation and retries activation without duplicates', async () => {
      state.empty = true; state.signupStatus = 500;
      const failure = await bootstrap();
      assert.equal(failure.status, 1); assert.match(failure.output, /cuenta está guardada/);
      assert.equal(counts.bootstrap, 1); assert.equal(state.invitation, 'failed'); assert.equal(state.created, false);
      const duplicate = await bootstrap();
      assert.equal(duplicate.status, 1); assert.match(duplicate.output, /ya tiene un superadministrador/);
      state.signupStatus = 200;
      const retry = await bootstrap(true);
      assert.equal(retry.status, 0, retry.output);
      assert.equal(counts.bootstrap, 1); assert.equal(state.created, true); assert.equal(state.invitation, 'sent');
      const before = counts.verify;
      assert.equal((await bootstrap(true)).status, 0); assert.equal(counts.verify, before + 1);
      assert.equal(counts.bootstrap, 1);
    });
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    if (browser) await browser.close();
    stopOwnedTree(next);
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
