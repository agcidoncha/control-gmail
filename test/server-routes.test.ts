import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATA_STORE = 'local';
process.env.SESSION_SECRET = 'test-server-secret-with-at-least-32-chars';
process.env.ADMIN_EMAILS = 'angel.cidoncha@gmail.com';
const testDataDirectory = await mkdtemp(join(tmpdir(), 'control-gmail-routes-'));
process.env.USER_STORE_FILE = join(testDataDirectory, 'users.json');
process.env.ORGANIZATION_STORE_FILE = join(testDataDirectory, 'organizations.json');
process.env.AI_CONNECTION_STORE_FILE = join(testDataDirectory, 'ai-connections.enc');
process.env.AI_CONNECTION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.CLAUDE_API_KEY = 'test-claude-key';
process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
await writeFile(process.env.USER_STORE_FILE, JSON.stringify([
  { email: 'angel.cidoncha@gmail.com', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-01-01T00:00:00.000Z' },
  { email: 'dev@publicidadsegmentadatv.com', role: 'commercial', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-01-01T00:00:00.000Z' },
], null, 2));
await writeFile(process.env.ORGANIZATION_STORE_FILE, JSON.stringify([
  { id: 'org_publicidad_segmentada_tv', name: 'Publicidad Segmentada TV', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
], null, 2));

const { app } = await import('../src/server.ts?server-routes-test');
const { sessionCookieHeader } = await import('../src/session.ts?server-routes-session-test');

test.after(async () => {
  await app.close();
  await rm(testDataDirectory, { recursive: true, force: true });
});

test('el health check confirma que la API está disponible', async () => {
  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, service: 'control-gmail' });
});

test('las rutas privadas rechazan peticiones sin sesión', async () => {
  const me = await app.inject({ method: 'GET', url: '/me' });
  const users = await app.inject({ method: 'GET', url: '/admin/users' });
  const messages = await app.inject({ method: 'GET', url: '/gmail/messages?account=angel.cidoncha%40gmail.com' });
  const navCounts = await app.inject({ method: 'GET', url: '/gmail/nav-counts' });
  const insights = await app.inject({ method: 'GET', url: '/gmail/insights' });
  const followUps = await app.inject({ method: 'GET', url: '/gmail/follow-ups' });
  const commitments = await app.inject({ method: 'GET', url: '/gmail/commitments' });
  const clientHistory = await app.inject({ method: 'GET', url: '/gmail/client-history?email=cliente%40empresa.test' });

  assert.equal(me.statusCode, 401);
  assert.equal(users.statusCode, 401);
  assert.equal(messages.statusCode, 401);
  assert.equal(navCounts.statusCode, 401);
  assert.equal(insights.statusCode, 401);
  assert.equal(followUps.statusCode, 401);
  assert.equal(commitments.statusCode, 401);
  assert.equal(clientHistory.statusCode, 401);
});

test('mensajes, clientes, seguimientos y compromisos rechazan fechas inválidas antes de consultar Gmail', async () => {
  for (const path of ['/gmail/messages', '/gmail/insights', '/gmail/follow-ups', '/gmail/commitments']) {
    for (const query of ['from=2026-10-12&to=2026-10-01', 'from=2026-02-30&to=2026-03-01', 'to=2999-01-01']) {
      const response = await app.inject({ method: 'GET', url: `${path}?${query}`, headers: { cookie: sessionCookieHeader('angel.cidoncha@gmail.com') } });
      assert.equal(response.statusCode, 400, `${path}?${query}`);
      assert.match(response.json().error, /fecha/i);
    }
  }
});

test('el administrador puede ver usuarios pero no contenido de correos', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/admin/users',
    headers: { cookie: sessionCookieHeader('angel.cidoncha@gmail.com') },
  });
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.users.length, 2);
  assert.equal('messages' in body.users[0], false);
  assert.equal('tokens' in body.users[0], false);
});

test('el comercial no puede acceder a administración', async () => {
  const me = await app.inject({
    method: 'GET',
    url: '/me',
    headers: { cookie: sessionCookieHeader('dev@publicidadsegmentadatv.com') },
  });
  const users = await app.inject({
    method: 'GET',
    url: '/admin/users',
    headers: { cookie: sessionCookieHeader('dev@publicidadsegmentadatv.com') },
  });

  assert.deepEqual(me.json(), { email: 'dev@publicidadsegmentadatv.com', organizationId: 'org_publicidad_segmentada_tv', role: 'commercial' });
  assert.equal(users.statusCode, 403);
});

test('el administrador autoriza usuarios y un comercial no puede hacerlo', async () => {
  const adminHeaders = { cookie: sessionCookieHeader('angel.cidoncha@gmail.com') };
  const commercialHeaders = { cookie: sessionCookieHeader('dev@publicidadsegmentadatv.com') };
  const denied = await app.inject({
    method: 'POST',
    url: '/admin/users',
    headers: { ...commercialHeaders, 'content-type': 'application/json' },
    payload: { email: 'otra-cuenta@gmail.com', role: 'commercial' },
  });
  assert.equal(denied.statusCode, 403);

  const authorized = await app.inject({
    method: 'POST',
    url: '/admin/users',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    payload: { email: 'otra-cuenta@gmail.com', role: 'commercial' },
  });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.json().user, {
    email: 'otra-cuenta@gmail.com',
    organizationId: 'org_publicidad_segmentada_tv',
    role: 'commercial',
    accessStatus: 'active',
  });
});

test('el administrador controla el proveedor global y el acceso por usuario', async () => {
  const adminHeaders = { cookie: sessionCookieHeader('angel.cidoncha@gmail.com') };
  const commercialHeaders = { cookie: sessionCookieHeader('dev@publicidadsegmentadatv.com') };

  const initialAdmin = await app.inject({ method: 'GET', url: '/admin/ai', headers: adminHeaders });
  assert.equal(initialAdmin.statusCode, 200);
  assert.equal(initialAdmin.json().activeProvider, 'openai');
  assert.equal(initialAdmin.json().providers.openai.configured, true);
  assert.equal(initialAdmin.json().users.find((user: { email: string }) => user.email === 'angel.cidoncha@gmail.com').aiProvider, undefined);
  assert.equal(initialAdmin.json().users.find((user: { email: string }) => user.email === 'dev@publicidadsegmentadatv.com').canUseSharedAi, false);

  const commercialConnections = await app.inject({ method: 'GET', url: '/ai/connections', headers: commercialHeaders });
  assert.equal(commercialConnections.statusCode, 200);
  assert.equal(commercialConnections.json().role, 'commercial');
  assert.equal(commercialConnections.json().company.canUse, false);
  assert.equal(commercialConnections.json().activeConnection, null);

  const permission = await app.inject({
    method: 'PATCH',
    url: '/admin/ai/users/dev%40publicidadsegmentadatv.com',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    payload: { canUseSharedAi: true },
  });
  assert.equal(permission.statusCode, 200);
  assert.equal(permission.json().canUseSharedAi, true);

  const assignment = await app.inject({
    method: 'PATCH',
    url: '/admin/ai/users/dev%40publicidadsegmentadatv.com',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    payload: { aiAccessEnabled: true, provider: 'deepseek', model: 'deepseek-flash' },
  });
  assert.equal(assignment.statusCode, 200);
  assert.deepEqual(assignment.json(), {
    email: 'dev@publicidadsegmentadatv.com',
    canUseSharedAi: true,
    aiAccessEnabled: true,
    aiProvider: 'deepseek',
    aiModel: 'deepseek-flash',
  });

  const grantedConnections = await app.inject({ method: 'GET', url: '/ai/connections', headers: commercialHeaders });
  assert.equal(grantedConnections.json().company.canUse, true);
  assert.deepEqual(grantedConnections.json().activeConnection, { mode: 'company_shared', provider: 'deepseek', model: 'deepseek-flash' });

  const personalConnection = await app.inject({
    method: 'POST',
    url: '/ai/connections/personal',
    headers: { ...commercialHeaders, 'content-type': 'application/json' },
    payload: { provider: 'claude', model: 'claude-sonnet-4-6', apiKey: 'test-personal-claude-key' },
  });
  assert.equal(personalConnection.statusCode, 200);

  const personalConnections = await app.inject({ method: 'GET', url: '/ai/connections', headers: commercialHeaders });
  assert.deepEqual(personalConnections.json().activeConnection, { mode: 'user_personal', provider: 'claude', model: 'claude-sonnet-4-6' });

  const disconnectedPersonal = await app.inject({ method: 'DELETE', url: '/ai/connections/personal', headers: commercialHeaders });
  assert.equal(disconnectedPersonal.statusCode, 200);

  const fallbackConnections = await app.inject({ method: 'GET', url: '/ai/connections', headers: commercialHeaders });
  assert.deepEqual(fallbackConnections.json().activeConnection, { mode: 'company_shared', provider: 'deepseek', model: 'deepseek-flash' });

  const attemptedAdminAssignment = await app.inject({
    method: 'PATCH',
    url: '/admin/ai/users/angel.cidoncha%40gmail.com',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    payload: { provider: 'claude', model: 'claude-opus-4-6' },
  });
  assert.equal(attemptedAdminAssignment.statusCode, 200);
  assert.equal(attemptedAdminAssignment.json().aiProvider, undefined);
  const adminConnections = await app.inject({ method: 'GET', url: '/ai/connections', headers: adminHeaders });
  assert.deepEqual(adminConnections.json().activeConnection, { mode: 'company_shared', provider: 'openai', model: 'gpt-6-luna' });

  const provider = await app.inject({
    method: 'PUT',
    url: '/admin/ai',
    headers: { ...adminHeaders, 'content-type': 'application/json' },
    payload: { provider: 'claude' },
  });
  assert.equal(provider.statusCode, 200);
  assert.equal(provider.json().activeProvider, 'claude');
});

test('cambiar de cuenta elimina la cookie anterior y redirige a OAuth', async () => {
  const response = await app.inject({ method: 'GET', url: '/auth/switch' });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/auth/google');
  assert.match(response.headers['set-cookie'] ?? '', /Max-Age=0/);
});
