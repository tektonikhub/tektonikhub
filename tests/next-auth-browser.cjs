'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { randomBytes, createHmac } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const roles = ['developer', 'catalog', 'admin', 'superadmin'];
const studioRoles = ['developer', 'admin', 'superadmin'];
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
const kit = require(path.join(root, 'lib', 'studio', 'runtime', 'dashboard-kit.js'));
const sourceConfig = kit.createConfig('Dashboard de operaciones con filtros y tabla');
const sourceHtml = kit.renderHTML(sourceConfig).replace('</head>', '<meta name="blk-generator" content="azure-openai"><meta name="blk-model" content="synthetic-model"></head>');
const sourceId = index => `00000000-0000-4000-8000-${String(300 + index).padStart(12, '0')}`;
const sourceRows = Array.from({ length: 13 }, (_, index) => ({
  id: sourceId(index), org_id: index === 3 ? '00000000-0000-4000-8000-000000000099' : orgId,
  author_id: index === 2 || index === 11 ? accounts[2].id : index === 12 ? accounts[3].id : accounts[0].id,
  deleted_at: index === 4 ? '2026-01-01T00:00:00Z' : null,
  version: index === 10 ? 4 : 3, review_status: index === 5 ? 'approved' : 'changes_requested',
  generated_html: index === 6 ? null : index === 9 ? 42 : index === 1 ? sourceHtml.replace('synthetic-model', 'second-model') : sourceHtml,
}));
const referenceFile = { name: 'reference.csv', type: 'text/csv', size: 42 };
let sourceVersion = 3, sourceReadFailure = false;
const sourceReads = [], commands = [];
const createdApps = [];
const flowEntries = new Map();
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
    plans: [{ id: planId, name: 'Initial', price: 0 }],
    apps: [...[sourceRows[0], sourceRows[1], sourceRows[6], sourceRows[11], sourceRows[12]].map(row => ({
      id: row.id, orgId, authorId: row.author_id, title: 'Synthetic dashboard', area: 'operations',
      desc: 'Synthetic submission description with enough characters.', tagline: 'Synthetic summary', impact: 'Synthetic impact',
      dataNote: 'Original data note', repoUrl: '', tech: ['Studio'], tags: [], security: [],
      attachments: [{ name: 'index.html', type: 'text/html', size: Buffer.byteLength(sourceHtml) }, referenceFile],
      metrics: { hours: 0, users: 0, rating: '-' }, reviewStatus: 'changes_requested', maturity: 'new', version: 3,
      ticket: `APP-${row.id.slice(-4)}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', environment: '',
    })), ...createdApps],
    reviews: [], events: [], policies: [],
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
    if (url.pathname === '/api/database/rpc/tk_flow_entries') {
      if (!account?.enabled || !account.verified) return fail(response, 401);
      return send(response, 200, [...(flowEntries.get(account.id)?.values() || [])]
        .filter(entry => createdApps.some(app => app.id === entry.appId && app.orgId === orgId && app.reviewStatus === 'approved')));
    }
    if (url.pathname === '/api/database/rpc/tk_flow_command') {
      assert.ok(account?.enabled && account.verified);
      assert.deepEqual(Object.keys(body).sort(), ['p_action', 'p_fields', 'p_id']);
      const app = createdApps.find(app => app.id === body.p_id && app.orgId === orgId && app.reviewStatus === 'approved');
      if (!app && body.p_action !== 'removeFromFlow') return send(response, 403, { code: '42501', message: 'App unavailable' });
      if (!flowEntries.has(account.id)) flowEntries.set(account.id, new Map());
      const entries = flowEntries.get(account.id);
      if (body.p_action === 'addToFlow') {
        if (!entries.has(app.id)) entries.set(app.id, { appId: app.id, favorite: false, createdAt: '2026-11-01T12:00:00Z' });
      } else if (body.p_action === 'setFlowFavorite') entries.get(app.id).favorite = body.p_fields.favorite;
      else entries.delete(body.p_id);
      return send(response, 200, { id: body.p_id });
    }
    if (['/api/database/records/apps', '/api/database/records/app_versions'].includes(url.pathname)) {
      assert.ok(account?.enabled && account.verified, 'Source must use the authenticated user token');
      assert.ok(studioRoles.includes(account.role));
      assert.equal(url.searchParams.get('org_id'), `eq.${orgId}`);
      assert.equal(url.searchParams.get('author_id'), `eq.${account.id}`);
      const versions = url.pathname.endsWith('/app_versions');
      const id = url.searchParams.get(versions ? 'app_id' : 'id')?.replace(/^eq\./, '');
      const row = sourceRows.find(row => row.id === id && row.org_id === orgId && row.author_id === account.id && !row.deleted_at);
      sourceReads.push({ versions, id });
      if (sourceReadFailure || id === sourceId(8)) return send(response, 500, { code: 'XX000', message: 'Synthetic source unavailable' });
      if (!row) return send(response, 200, []);
      if (!versions) {
        assert.equal(url.searchParams.get('select'), 'version,review_status');
        assert.equal(url.searchParams.get('deleted_at'), 'is.null');
        return send(response, 200, [{ version: id === sourceId(0) ? sourceVersion : row.version, review_status: row.review_status }]);
      }
      assert.equal(url.searchParams.get('select'), 'generated_html');
      assert.equal(url.searchParams.get('version'), 'eq.3');
      return send(response, 200, id === sourceId(7) ? [] : [{ generated_html: row.generated_html }]);
    }
    if (url.pathname === '/api/database/rpc/tk_command') {
      assert.ok(account?.enabled && account.verified);
      commands.push({ ...body, role: account.role });
      if (body.p_action === 'updateOrganization') {
        assert.equal(account.role, 'superadmin');
        assert.equal(Object.hasOwn(body.p_fields, 'members'), false);
        return send(response, 200, { id: orgId });
      }
      if (body.p_action === 'saveManagedApp') {
        assert.equal(account.role, 'admin');
        return send(response, 200, { id: body.p_id || sourceId(0) });
      }
      if (body.p_action === 'savePlan') {
        assert.equal(account.role, 'superadmin');
        return send(response, 200, { id: planId });
      }
      if (body.p_action === 'updateSubmission') {
        const row = sourceRows.find(row => row.id === body.p_id);
        if (!studioRoles.includes(account.role) || !row || row.author_id !== account.id || row.org_id !== orgId || row.review_status !== 'changes_requested') {
          return send(response, 403, { code: '42501', message: 'Synthetic unauthorized submission' });
        }
        if (body.p_version !== (row.id === sourceId(0) ? sourceVersion : row.version)) {
          return send(response, 409, { code: '40001', message: 'Synthetic concurrent version change' });
        }
        assert.equal(body.p_fields.generatedHtml, sourceHtml);
        assert.deepEqual(body.p_fields.attachments.filter(file => file.name !== 'index.html'), [referenceFile]);
        assert.equal(body.p_fields.dataNote, 'Original data note');
        return send(response, 200, { id: body.p_id });
      }
      if (body.p_action === 'createSubmission') {
        if (!studioRoles.includes(account.role)) return send(response, 403, { code: '42501', message: 'Synthetic unauthorized submission' });
        assert.equal(body.p_id, null);
        assert.match(body.p_fields.generatedHtml, /name="blk-generator" content="azure-openai"/);
        const id = sourceId(13 + createdApps.length);
        createdApps.push({
          ...workspace(account).apps[0], id, authorId: account.id, orgId,
          title: body.p_fields.title, desc: body.p_fields.desc, area: body.p_fields.area,
          attachments: body.p_fields.attachments, reviewStatus: 'pending_review', version: 1, ticket: `APP-${id.slice(-4)}`,
        });
        return send(response, 200, { id });
      }
      throw new Error(`Unexpected command ${body.p_action}`);
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
    await run('Homepage works without historical datasets and exposes only current public assets', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage();
        const datasetRequests = [];
        page.on('request', request => { if (new URL(request.url()).pathname === '/data.json') datasetRequests.push(request.url()); });
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(base);
        await page.getByRole('link', { name: 'Entrar al hub', exact: true }).first().waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        assert.equal(await page.locator('.preview-kpis, .landing-metrics, .landing-pricing').count(), 0);
        assert.doesNotMatch(await page.locator('main').innerText(), /fixture|demo local|Sin backend conectado/i);
        await page.getByRole('button', { name: 'ES / EN', exact: true }).click();
        await page.getByRole('link', { name: 'Enter the hub', exact: true }).first().waitFor();
        await page.getByRole('button', { name: 'Data and privacy', exact: true }).click();
        await page.getByRole('dialog').getByText(/business data is stored in InsForge/).waitFor();
        assert.deepEqual(datasetRequests, []);
        for (const pathname of ['/data.json', '/Old/index.html', '/my-flow.html']) {
          assert.equal((await page.request.get(base + pathname)).status(), 404, pathname);
        }
        assert.equal((await page.request.get(base + '/engines/dashboard-kit.js')).status(), 200);
      } finally { await ctx.close(); }
    });
    await run('Simple login supports mobile, password visibility, keyboard errors and both languages', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage();
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(base + '/login');
        await page.getByRole('heading', { name: 'Inicia sesión', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        const identifier = page.getByLabel('Usuario o correo electrónico');
        const secret = page.getByLabel('Contraseña', { exact: true });
        await identifier.fill('developer');
        await secret.fill('incorrect');
        assert.equal(await secret.getAttribute('type'), 'password');
        await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
        assert.equal(await secret.getAttribute('type'), 'text');
        assert.equal(await secret.inputValue(), 'incorrect');
        await page.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
        assert.equal(await secret.getAttribute('type'), 'password');
        await secret.focus();
        await secret.dispatchEvent('keyup', { key: 'A', modifierCapsLock: true });
        await page.getByText('Bloq Mayús está activado.', { exact: true }).waitFor();
        await secret.dispatchEvent('keyup', { key: 'a', modifierCapsLock: false });
        assert.equal(await page.locator('#login-caps-lock').count(), 0);
        await secret.press('Enter');
        const error = page.locator('.business-error[role="alert"]');
        await error.waitFor();
        assert.match(await error.innerText(), /Credenciales incorrectas/);
        assert.equal(await error.evaluate(element => element === document.activeElement), true);
        assert.equal(await identifier.inputValue(), 'developer');
        assert.equal(await secret.inputValue(), 'incorrect');
        assert.equal(await page.getByRole('button', { name: 'Entrar', exact: true }).isEnabled(), true);
        assert.equal(await page.getByRole('link', { name: '¿Has olvidado tu contraseña?', exact: true }).getAttribute('href'), '/reset-password');
        assert.equal(await page.getByRole('link', { name: 'Activar cuenta', exact: true }).getAttribute('href'), '/reset-password?activate=1');
        await page.getByRole('button', { name: 'English', exact: true }).click();
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        assert.equal(await page.locator('main').getAttribute('lang'), 'en');
        await page.reload();
        await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Español', exact: true }).click();
        await page.getByRole('heading', { name: 'Inicia sesión', exact: true }).waitFor();
      } finally { await ctx.close(); }
    });
    await run('Mi Flow persists catalog selections, favorites and both views with keyboard, drag and mobile support', async () => {
      const seed = workspace(accounts[0]).apps[0];
      const miniApps = Array.from({ length: 12 }, (_, index) => ({
        ...seed, id: `00000000-0000-4000-8000-${String(800 + index).padStart(12, '0')}`,
        title: `Mini app ${String(index + 1).padStart(2, '0')}`, reviewStatus: 'approved', attachments: [], version: 1,
      }));
      createdApps.push(...miniApps);
      const ctx = await context();
      try {
        const page = await ctx.newPage();
        await login(page, 'catalog', '/mi-flow');
        await page.getByRole('heading', { name: 'Tu Flowverse empieza contigo.' }).waitFor();
        await page.getByRole('link', { name: 'Añadir mini apps', exact: true }).click();
        const card = page.locator('.business-app-card').filter({ has: page.getByRole('heading', { name: 'Mini app 01', exact: true }) });
        await card.waitFor();
        assert.deepEqual(await card.locator('.business-actions button').allTextContents(), ['Detalles', 'Añadir', 'Acceder']);
        await card.getByRole('button', { name: 'Añadir a Mi Flow', exact: true }).click();
        await card.getByRole('button', { name: 'Añadida a Mi Flow', exact: true }).waitFor();
        assert.equal(await card.getByRole('button', { name: 'Añadida a Mi Flow', exact: true }).isDisabled(), true);
        for (const app of miniApps) assert.equal((await post(page, '/api/workspace', { action: 'addToFlow', id: app.id, fields: {} })).status, 200);
        await page.goto(base + '/mi-flow');
        await page.locator('.flow-orbit-app').first().waitFor();
        assert.equal(await page.locator('.flow-orbit-app').count(), 8);
        await page.getByRole('button', { name: 'Siguiente mini app', exact: true }).click();
        await page.locator('.flow-orbit-caption strong').filter({ hasText: 'Mini app 02' }).waitFor();
        await page.locator('.flow-orbit-stage').focus();
        await page.keyboard.press('ArrowLeft');
        await page.locator('.flow-orbit-caption strong').filter({ hasText: 'Mini app 01' }).waitFor();
        await page.getByRole('button', { name: 'Mini app anterior', exact: true }).click();
        await page.locator('.flow-orbit-caption strong').filter({ hasText: 'Mini app 12' }).waitFor();
        assert.equal(await page.locator('.flow-orbit-app').count(), 4);
        await page.getByRole('button', { name: 'Siguiente mini app', exact: true }).click();
        await page.getByRole('button', { name: 'Añadir a favoritos', exact: true }).click();
        await page.getByRole('button', { name: 'Quitar de favoritos', exact: true }).waitFor();
        await page.reload();
        assert.equal(await page.getByRole('button', { name: 'Quitar de favoritos', exact: true }).getAttribute('aria-pressed'), 'true');
        const artifacts = process.env.TEKTONIK_FLOW_ARTIFACTS;
        if (artifacts) await page.screenshot({ path: path.join(artifacts, 'flow-orbit-desktop.png'), fullPage: true });
        await page.getByRole('button', { name: 'Tarjetas', exact: true }).click();
        assert.equal(await page.locator('.flow-review-card').count(), 12);
        if (artifacts) await page.screenshot({ path: path.join(artifacts, 'flow-cards-desktop.png'), fullPage: true });
        await page.getByRole('button', { name: 'Favoritas 1', exact: true }).click();
        assert.equal(await page.locator('.flow-review-card').count(), 1);
        await page.getByLabel('Buscar en Mi Flow', { exact: true }).fill('no existe');
        await page.getByRole('heading', { name: 'No hay mini apps en esta órbita.' }).waitFor();
        await page.getByRole('button', { name: 'Ver todas mis mini apps', exact: true }).click();
        assert.equal(await page.locator('.flow-review-card').count(), 12);
        await page.getByRole('button', { name: 'Órbita', exact: true }).click();
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.waitForTimeout(450);
        const bounds = await page.locator('.flow-orbit-stage').boundingBox();
        for (const node of await page.locator('.flow-orbit-app').all()) {
          const box = await node.boundingBox();
          assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1, 'Orbit node must fit mobile stage');
        }
        if (artifacts) await page.screenshot({ path: path.join(artifacts, 'flow-orbit-mobile.png'), fullPage: true });
        await page.locator('.flow-orbit-stage').scrollIntoViewIfNeeded();
        const stage = await page.locator('.flow-orbit-stage').boundingBox();
        await page.mouse.move(stage.x + 20, stage.y + 20); await page.mouse.down();
        await page.mouse.move(stage.x + 80, stage.y + 20, { steps: 5 }); await page.mouse.up();
        await page.locator('.flow-orbit-caption strong').filter({ hasText: 'Mini app 12' }).waitFor();
        await page.getByRole('button', { name: 'Quitar de Mi Flow', exact: true }).click();
        await page.locator('.flow-orbit-caption span').filter({ hasText: '/ 11' }).waitFor();
        await page.reload();
        assert.equal(await page.locator('.flow-stats > div').first().locator('strong').innerText(), '11');
        const before = flowEntries.get(accounts[1].id).size;
        const rejected = await post(page, '/api/workspace', { action: 'addToFlow', id: miniApps[0].id, fields: { userId: accounts[0].id } });
        assert.equal(rejected.status, 400);
        assert.equal(flowEntries.get(accounts[1].id).size, before);
        miniApps[0].reviewStatus = 'pending_review';
        await page.reload();
        assert.equal(await page.locator('.flow-stats > div').first().locator('strong').innerText(), '10');
        const other = await context();
        try {
          const otherPage = await other.newPage(); await login(otherPage, 'admin', '/mi-flow');
          await otherPage.getByRole('heading', { name: 'Tu Flowverse empieza contigo.' }).waitFor();
        } finally { await other.close(); }
      } finally {
        await ctx.close(); flowEntries.clear(); createdApps.splice(0, miniApps.length);
      }
    });
    await run('Email sign-in submits once, shows progress and follows the authorized destination', async () => {
      const ctx = await context();
      let release;
      try {
        const page = await ctx.newPage();
        await page.goto(base + '/login?next=%2Fcompany');
        await page.getByLabel('Usuario o correo electrónico').fill(accounts[0].email);
        await page.getByLabel('Contraseña', { exact: true }).fill(password);
        const readyToRelease = new Promise(resolve => { release = resolve; });
        await page.route('**/api/auth/login', async route => { await readyToRelease; await route.continue(); });
        const before = counts.login;
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        const pending = page.getByRole('button', { name: 'Accediendo…', exact: true });
        await pending.waitFor();
        assert.equal(await pending.isDisabled(), true);
        assert.equal(await page.getByLabel('Usuario o correo electrónico').isDisabled(), true);
        assert.equal(await page.getByLabel('Contraseña', { exact: true }).isDisabled(), true);
        release();
        await page.waitForURL(base + '/company');
        assert.equal(counts.login, before + 1);
        assert.equal((await session(page)).body.role, 'developer');
      } finally { release?.(); await ctx.close(); }
    });
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
    await run('Studio login, page guards, desktop/mobile navigation and profile links allow creators and admins but not catalog', async () => {
      for (const role of roles) {
        const ctx = await context();
        try {
          const page = await ctx.newPage();
          const allowed = studioRoles.includes(role);
          assert.equal(await login(page, role, '/studio'), allowed ? '/studio' : '/catalog');
          const nav = page.getByRole('navigation', { name: 'Navegación principal', exact: true });
          assert.equal(await nav.getByRole('link', { name: 'Tektonik hub Studio', exact: true }).count(), allowed ? 1 : 0);
          await page.goto(base + '/studio');
          await page.waitForURL(base + (allowed ? '/studio' : '/catalog'));
          if (allowed) {
            await page.getByTestId('studio-workspace').waitFor();
            await page.waitForFunction(() => document.querySelector('#promptInput')?.disabled === false);
            assert.equal(await page.getByRole('heading', { name: 'Acceso no disponible', exact: true }).count(), 0);
            await page.reload();
            await page.getByTestId('studio-workspace').waitFor();
          }
          await page.goto(base + '/profile');
          assert.equal(await page.getByRole('link', { name: 'Crear aplicación', exact: true }).count(), allowed ? 1 : 0);
          await page.getByRole('button', { name: 'Mis envíos', exact: true }).click();
          assert.equal(await page.getByRole('link', { name: 'Corregir y reenviar', exact: true }).count(), role === 'developer' ? 3 : allowed ? 1 : 0);
          if (allowed) {
            await page.setViewportSize({ width: 375, height: 812 });
            await page.getByRole('button', { name: 'Abrir navegación', exact: true }).click();
            await nav.getByRole('link', { name: 'Tektonik hub Studio', exact: true }).click();
            await page.waitForURL(base + '/studio');
            await page.getByTestId('studio-workspace').waitFor();
          }
          if (role === 'admin' || role === 'superadmin') {
            await page.goto(`${base}/profile?user=${accounts[0].id}`);
            assert.equal(await page.getByRole('link', { name: 'Crear aplicación', exact: true }).count(), 0);
            assert.equal(await page.getByRole('link', { name: 'Corregir y reenviar', exact: true }).count(), 0);
          }
        } finally { await ctx.close(); }
      }
    });
    await run('Studio source API enforces identity, author, tenant, status and immutable version with explicit failures', async () => {
      const guest = await fetch(`${base}/api/studio/source?appId=${sourceId(0)}&version=3`);
      assert.equal(guest.status, 401);
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'developer');
        const getSource = (query) => page.evaluate(async query => {
          const response = await fetch('/api/studio/source?' + query);
          return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
        }, query);
        const source = await getSource(`appId=${sourceId(0)}&version=3`);
        assert.equal(source.status, 200, JSON.stringify(source.body));
        assert.equal(source.cache, 'private, no-store');
        assert.deepEqual(source.body, { appId: sourceId(0), version: 3, generatedHtml: sourceHtml });
        for (const query of ['appId=invalid&version=3', `appId=${sourceId(0)}&version=0`, `appId=${sourceId(0)}&version=1.2`,
          `appId=${sourceId(0)}&version=2147483648`, `appId=${sourceId(0)}&version=3&extra=1`]) {
          assert.equal((await getSource(query)).status, 400);
        }
        for (const index of [2, 3, 4]) assert.equal((await getSource(`appId=${sourceId(index)}&version=3`)).status, 404);
        for (const index of [5, 7, 10]) assert.equal((await getSource(`appId=${sourceId(index)}&version=3`)).status, 409);
        const absent = await getSource(`appId=${sourceId(6)}&version=3`);
        assert.equal(absent.status, 200); assert.equal(absent.body.generatedHtml, null);
        for (const index of [8, 9]) assert.equal((await getSource(`appId=${sourceId(index)}&version=3`)).status, 503);
      } finally { await ctx.close(); }
      for (const role of ['catalog', 'admin', 'superadmin']) {
        const other = await context();
        try {
          const page = await other.newPage(); await login(page, role);
          const before = sourceReads.length;
          const response = await page.evaluate(async id => (await fetch(`/api/studio/source?appId=${id}&version=3`)).status, sourceId(0));
          assert.equal(response, role === 'catalog' ? 403 : 404);
          assert.equal(sourceReads.length, before + (role === 'catalog' ? 0 : 1));
          if (role !== 'catalog') {
            const id = sourceId(role === 'admin' ? 11 : 12);
            const own = await page.evaluate(async id => {
              const response = await fetch(`/api/studio/source?appId=${id}&version=3`);
              return { status: response.status, body: await response.json() };
            }, id);
            assert.equal(own.status, 200);
            assert.deepEqual(own.body, { appId: id, version: 3, generatedHtml: sourceHtml });
          }
        } finally { await other.close(); }
      }
    });
    await run('Admin and superadmin can correct and create their own Studio submissions without bypassing ownership or version checks', async () => {
      for (const role of ['admin', 'superadmin']) {
        const ctx = await context();
        try {
          const page = await ctx.newPage(); await login(page, role, '/profile');
          await page.getByRole('button', { name: 'Mis envíos', exact: true }).click();
          await page.getByRole('link', { name: 'Corregir y reenviar', exact: true }).click();
          const id = sourceId(role === 'admin' ? 11 : 12);
          await page.waitForURL(`${base}/studio?edit=${id}`);
          await page.waitForFunction(() => document.querySelector('#versionSelect')?.disabled === false);
          await page.getByRole('button', { name: 'Enviar a IT', exact: true }).click();
          let dialog = page.getByRole('dialog');
          await dialog.getByRole('button', { name: 'Enviar cambios a IT', exact: true }).click();
          await dialog.getByText(/El envío se guardó/).waitFor();
          const correction = commands.at(-1);
          assert.equal(correction.p_action, 'updateSubmission'); assert.equal(correction.role, role);
          assert.equal(correction.p_id, id); assert.equal(correction.p_version, 3);
          assert.equal((await post(page, '/api/workspace', {
            action: 'updateSubmission', id: sourceId(0), fields: correction.p_fields, version: 3,
          })).status, 403);
          assert.equal((await post(page, '/api/workspace', {
            action: 'updateSubmission', id, fields: correction.p_fields, version: 2,
          })).status, 409);
          await page.route('**/api/session', route => route.fulfill({ status: 200, json: { csrf: 'a'.repeat(64) } }));
          await page.route('**/api/studio/generate', async route => {
            const body = route.request().postDataJSON();
            assert.equal(body.orgId, orgId); assert.equal(body.previous, null);
            await route.fulfill({ status: 200, json: { provider: 'azure-openai', model: 'synthetic-model', config: sourceConfig } });
          });
          await page.goto(base + '/studio');
          await page.waitForFunction(() => document.querySelector('#promptInput')?.disabled === false);
          await page.locator('#promptInput').fill('Dashboard de operaciones con filtros y tabla para mi organización');
          await page.getByRole('button', { name: 'Generar herramienta', exact: true }).click();
          await page.getByRole('button', { name: 'Enviar a IT', exact: true }).waitFor();
          const html = await page.locator('#codePanel code').textContent();
          await page.getByRole('button', { name: 'Enviar a IT', exact: true }).click();
          dialog = page.getByRole('dialog');
          await dialog.getByRole('button', { name: 'Enviar a IT', exact: true }).click();
          await dialog.getByText(/El envío se guardó/).waitFor();
          const submission = commands.at(-1), created = createdApps.at(-1);
          assert.equal(submission.p_action, 'createSubmission'); assert.equal(submission.role, role);
          assert.equal(submission.p_fields.generatedHtml, html);
          assert.equal(created.authorId, accounts.find(account => account.role === role).id);
          assert.equal(created.orgId, orgId); assert.equal(created.reviewStatus, 'pending_review');
          await page.reload();
          await page.getByRole('button', { name: 'Enviado a IT', exact: true }).waitFor();
        } finally { await ctx.close(); }
      }
    });
    await run('Minimal Studio verifies the organization LLM, exposes its tooltip and attaches removable file references from the top bar', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'developer');
        let connection = 'configured', release, notify;
        const statusResponse = configured => ({ available: true, configured, endpoint: 'https://synthetic.openai.azure.com', deployment: 'synthetic-model', apiVersion: '2024-10-21', storage: 'server-memory' });
        await page.route('**/api/llm/settings?**', async route => {
          assert.equal(new URL(route.request().url()).searchParams.get('orgId'), orgId);
          if (connection === 'pending') {
            notify();
            await new Promise(resolve => { release = resolve; });
          }
          await route.fulfill({ status: connection === 'unavailable' ? 503 : 200, json: connection === 'unavailable' ? { error: 'Unavailable' } : statusResponse(connection === 'configured') });
        });
        await page.goto(base + '/studio');
        const dot = page.locator('.studio-connection-dot'), indicator = page.locator('.studio-connection-button');
        await page.waitForFunction(() => document.querySelector('.studio-connection-dot')?.dataset.state === 'configured');
        assert.equal(await dot.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(21, 128, 61)');
        await indicator.hover();
        const tooltip = page.getByRole('tooltip');
        assert.equal(await tooltip.isVisible(), true);
        assert.equal(await tooltip.innerText(), 'El LLM de la organización está correctamente configurado.');
        await page.mouse.move(0, 0); await indicator.focus();
        assert.equal(await tooltip.isVisible(), true);
        assert.equal(await page.locator('.studio-next .page-heading, .studio-files, .studio-history, .studio-starters').count(), 0);
        assert.equal(await page.getByRole('heading', { name: 'De idea a herramienta', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: /Exportar.*JSON/ }).count(), 0);
        assert.match(await page.locator('.studio-top-status').innerText(), /Nuevo borrador/);
        const toolbar = await page.locator('.studio-toolbar').boundingBox(), add = await page.getByRole('button', { name: 'Añadir ficheros', exact: true }).boundingBox();
        assert.ok(add.x > toolbar.x + toolbar.width / 2, 'File control should be on the right');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Añadir ficheros', exact: true }).click();
        await (await chooser).setFiles({ name: 'design.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic reference content not imported') });
        await page.getByRole('button', { name: 'Quitar design.txt', exact: true }).waitFor();
        assert.match(await page.locator('.studio-attachments').innerText(), /Solo referencias/);
        const key = `blkunit:studio:v1:${orgId}:${accounts[0].id}:new`;
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').files?.length === 1, key);
        const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
        assert.deepEqual(saved.files, [{ name: 'design.txt', type: 'text/plain', size: 40 }]);
        assert.equal(JSON.stringify(saved).includes('Synthetic reference content'), false);
        await page.getByRole('button', { name: 'Quitar design.txt', exact: true }).click();
        await page.locator('.studio-attachments').waitFor({ state: 'hidden' });
        connection = 'unconfigured'; await indicator.click();
        await page.waitForFunction(() => document.querySelector('.studio-connection-dot')?.dataset.state === 'unconfigured');
        assert.match(await indicator.getAttribute('aria-label'), /aún no está configurado/);
        connection = 'pending';
        const pending = new Promise(resolve => { notify = resolve; });
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await pending;
        assert.equal(await dot.getAttribute('data-state'), 'checking', 'Never retain a stale green light during a refresh');
        connection = 'unavailable'; release();
        await page.waitForFunction(() => document.querySelector('.studio-connection-dot')?.dataset.state === 'unavailable');
        assert.match(await indicator.getAttribute('aria-label'), /No se pudo comprobar/);
        connection = 'configured'; await indicator.click();
        await page.waitForFunction(() => document.querySelector('.studio-connection-dot')?.dataset.state === 'configured');
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await indicator.focus();
        const bounds = await tooltip.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375, 'Tooltip should fit the mobile viewport');
        await page.getByRole('button', { name: 'Herramienta', exact: true }).click();
        await page.getByRole('tab', { name: 'Preview', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Conversación', exact: true }).click();
        await page.getByRole('button', { name: 'Nuevo borrador', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
        await page.locator('#promptInput').fill('Una nueva descripción');
      } finally { await ctx.close(); }
    });
    await run('Fresh-browser Studio restores stored HTML, data, provenance and attachments before submitting the original ticket', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'developer');
        await page.goto(`${base}/studio?edit=${sourceId(0)}`);
        await page.getByLabel('Más opciones de la vista previa', { exact: true }).click();
        await page.getByRole('button', { name: 'Crear rama', exact: true }).waitFor();
        await page.waitForFunction(() => !document.querySelector('#versionSelect')?.disabled);
        await page.getByRole('tab', { name: 'Código HTML', exact: true }).click();
        assert.equal(await page.locator('#codePanel code').textContent(), sourceHtml);
        assert.match(await page.locator('.studio-attachments li').getAttribute('title'), /text\/csv/);
        await page.getByRole('button', { name: 'Quitar reference.csv', exact: true }).waitFor();
        const sandbox = page.locator('#previewFrame');
        assert.equal(await sandbox.getAttribute('sandbox'), 'allow-scripts');
        assert.match(await sandbox.getAttribute('srcdoc'), /connect-src 'none'/);
        await page.getByRole('button', { name: 'Crear rama', exact: true }).click();
        const key = `blkunit:studio:v1:${orgId}:${accounts[0].id}:${sourceId(0)}`;
        await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || '{}').selectedId === 2, key);
        const draft = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
        assert.equal(draft.editing.expectedVersion, 3);
        assert.equal(draft.versions[0].provider, 'azure-openai');
        assert.equal(draft.versions[0].model, 'synthetic-model');
        assert.deepEqual(draft.versions[0].spec.dashboard.data, sourceConfig.data);
        assert.deepEqual(draft.files, [referenceFile]);
        const before = sourceReads.length;
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#versionSelect')?.value === '2');
        assert.equal(sourceReads.length, before, 'A valid local edit must not be replaced with server HTML');
        await page.getByRole('button', { name: 'Enviar a IT', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        assert.equal(await dialog.getByLabel(/^Descripción/).getAttribute('minlength'), '30');
        assert.equal(await dialog.getByLabel('Resumen', { exact: true }).getAttribute('maxlength'), '100');
        assert.equal(await dialog.getByLabel(/^Datos utilizados/).inputValue(), 'Original data note');
        const prior = commands.length;
        await dialog.getByRole('button', { name: 'Enviar cambios a IT', exact: true }).click();
        await dialog.getByText(/El envío se guardó/).waitFor();
        assert.equal(commands.length, prior + 1);
        assert.equal(commands.at(-1).p_action, 'updateSubmission');
        assert.equal(commands.at(-1).p_version, 3);
      } finally { await ctx.close(); }
    });
    await run('Studio refuses stale correction submission without losing the draft and exposes source retry/null states', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'developer');
        sourceReadFailure = true;
        await page.goto(`${base}/studio?edit=${sourceId(0)}`);
        await page.getByRole('button', { name: 'Reintentar apertura', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Generar herramienta', exact: true }).isDisabled(), true);
        sourceReadFailure = false;
        await page.getByRole('button', { name: 'Reintentar apertura', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('#versionSelect')?.disabled);
        sourceVersion = 4;
        await page.getByRole('button', { name: 'Enviar a IT', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Enviar cambios a IT', exact: true }).click();
        await page.getByRole('dialog').getByRole('alert').waitFor();
        assert.match(await page.getByRole('dialog').getByRole('alert').innerText(), /falló/);
        assert.equal(await page.getByRole('dialog').getByText(/El envío se guardó/).count(), 0);
        await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
        await page.getByRole('tab', { name: 'Código HTML', exact: true }).click();
        assert.equal(await page.locator('#codePanel code').textContent(), sourceHtml);
        sourceVersion = 3;
        await page.goto(`${base}/studio?edit=${sourceId(6)}`);
        await page.getByText(/Este envío no contiene HTML generado/).waitFor();
        assert.equal(await page.getByLabel('Describe tu primera idea', { exact: true }).isEnabled(), true);
      } finally { sourceReadFailure = false; sourceVersion = 3; await ctx.close(); }
    });
    await run('Corrupt local edit stays protected and a delayed source cannot overwrite a different ticket', async () => {
      const ctx = await context();
      let release;
      try {
        const page = await ctx.newPage(); await login(page, 'developer');
        const key = `blkunit:studio:v1:${orgId}:${accounts[0].id}:${sourceId(0)}`;
        await page.evaluate(key => localStorage.setItem(key, '{corrupt'), key);
        const before = sourceReads.length;
        await page.goto(`${base}/studio?edit=${sourceId(0)}`);
        await page.getByText(/El original NO se sobrescribirá/).waitFor();
        assert.equal(sourceReads.length, before);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{corrupt');
        await page.evaluate(key => localStorage.removeItem(key), key);
        let pending, completed;
        const held = new Promise(resolve => { pending = resolve; });
        const finished = new Promise(resolve => { completed = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/api/studio/source?**', async route => {
          if (new URL(route.request().url()).searchParams.get('appId') !== sourceId(0)) return route.continue();
          pending();
          await gate;
          await route.fulfill({ response: await route.fetch() });
          completed();
        });
        await page.reload(); await held;
        await page.evaluate(id => history.pushState(null, '', `/studio?edit=${id}`), sourceId(1));
        await page.waitForFunction(() => !document.querySelector('#versionSelect')?.disabled);
        await page.getByRole('tab', { name: 'Código HTML', exact: true }).click();
        const secondHtml = sourceRows[1].generated_html;
        assert.equal(await page.locator('#codePanel code').textContent(), secondHtml);
        release(); await finished;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#codePanel code').textContent(), secondHtml);
        assert.match(await page.locator('.studio-top-status').innerText(), /APP-0301/);
      } finally { release?.(); await ctx.close(); }
    });
    await run('Organization member count is derived and edits never send or accept a fabricated members value', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'superadmin');
        await page.getByRole('button', { name: 'Editar', exact: true }).click();
        const dialog = page.getByRole('dialog');
        const members = dialog.getByLabel('Miembros registrados · calculado automáticamente', { exact: true });
        assert.equal(await members.getAttribute('readonly'), '');
        assert.equal(await members.getAttribute('name'), null);
        assert.equal(await members.inputValue(), '4');
        const prior = commands.length;
        await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(commands.length, prior + 1);
        assert.equal(commands.at(-1).p_action, 'updateOrganization');
        assert.equal(Object.hasOwn(commands.at(-1).p_fields, 'members'), false);
        const invalid = await post(page, '/api/workspace', {
          action: 'updateOrganization', id: orgId,
          fields: { name: 'Synthetic organization', domain: '', email: accounts[2].email, plan: planId, adminId: accounts[2].id, status: 'active', members: 999 },
        });
        assert.equal(invalid.status, 400); assert.equal(commands.length, prior + 1);
        accounts[2].enabled = false;
        await page.reload();
        await page.getByRole('button', { name: 'Editar', exact: true }).click();
        const adminSelect = page.getByRole('dialog').getByLabel(/^Administrador/);
        assert.equal(await adminSelect.locator(`option[value="${accounts[2].id}"]`).count(), 0);
        assert.equal(await adminSelect.getAttribute('required'), '');
        assert.equal(await adminSelect.evaluate(select => select.checkValidity()), false);
        await adminSelect.selectOption(accounts[3].id);
        assert.equal(await adminSelect.evaluate(select => select.checkValidity()), true);
      } finally { accounts[2].enabled = true; await ctx.close(); }
    });
    await run('Managed app and plan UI/API limits match PostgreSQL without accepting overlong summaries or overflowing numbers', async () => {
      const ctx = await context();
      try {
        const page = await ctx.newPage(); await login(page, 'admin');
        await page.getByRole('button', { name: 'Editar', exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        const authorSelect = dialog.getByLabel(/^Creador/);
        await authorSelect.waitFor();
        for (const account of accounts) {
          assert.equal(await authorSelect.locator(`option[value="${account.id}"]`).count(), studioRoles.includes(account.role) ? 1 : 0, account.role);
        }
        assert.equal(await dialog.getByLabel('Subtítulo', { exact: true }).getAttribute('maxlength'), '100');
        assert.equal(await dialog.getByLabel('Horas ahorradas · estimación', { exact: true }).getAttribute('max'), '2147483647');
        await dialog.getByLabel('Subtítulo', { exact: true }).fill('x'.repeat(100));
        await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        const fields = commands.at(-1).p_fields, before = commands.length;
        assert.equal(fields.tagline.length, 100);
        assert.equal((await post(page, '/api/workspace', { action: 'saveManagedApp', id: sourceId(0), fields: { ...fields, hours: 2147483647, users: 2147483647 }, version: 3 })).status, 200);
        for (const changed of [{ ...fields, tagline: 'x'.repeat(101) }, { ...fields, hours: 2147483648 }, { ...fields, users: 2147483648 }]) {
          const result = await post(page, '/api/workspace', { action: 'saveManagedApp', id: sourceId(0), fields: changed, version: 3 });
          assert.equal(result.status, 400);
        }
        assert.equal(commands.length, before + 1);
      } finally { await ctx.close(); }
      const admin = await context();
      try {
        const page = await admin.newPage(); await login(page, 'superadmin');
        await page.getByRole('button', { name: 'Planes', exact: true }).click();
        await page.getByRole('button', { name: 'Editar', exact: true }).click();
        const dialog = page.getByRole('dialog');
        assert.equal(await dialog.getByLabel('Precio mensual (€); vacío = consultar', { exact: true }).getAttribute('max'), '9999999999.99');
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        assert.equal((await post(page, '/api/workspace', { action: 'savePlan', id: planId, fields: { name: 'Synthetic', price: 9999999999.99 } })).status, 200);
        assert.equal((await post(page, '/api/workspace', { action: 'savePlan', id: planId, fields: { name: 'Synthetic', price: 10000000000 } })).status, 400);
      } finally { await admin.close(); }
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
