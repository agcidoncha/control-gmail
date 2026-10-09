import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-server-secret-with-at-least-32-chars';
process.env.ADMIN_EMAILS = 'angel.cidoncha@gmail.com';
process.env.USER_STORE_FILE = join(await mkdtemp(join(tmpdir(), 'control-gmail-routes-')), 'users.json');
await writeFile(process.env.USER_STORE_FILE, JSON.stringify([
  { email: 'angel.cidoncha@gmail.com', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-01-01T00:00:00.000Z' },
  { email: 'dev@publicidadsegmentadatv.com', role: 'commercial', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-01-01T00:00:00.000Z' },
], null, 2));

const { app } = await import('../src/server.ts?server-routes-test');
const { sessionCookieHeader } = await import('../src/session.ts?server-routes-session-test');

test.after(async () => {
  await app.close();
  await rm(process.env.USER_STORE_FILE!, { force: true });
});

test('las rutas privadas rechazan peticiones sin sesión', async () => {
  const me = await app.inject({ method: 'GET', url: '/me' });
  const users = await app.inject({ method: 'GET', url: '/admin/users' });
  const messages = await app.inject({ method: 'GET', url: '/gmail/messages?account=angel.cidoncha%40gmail.com' });

  assert.equal(me.statusCode, 401);
  assert.equal(users.statusCode, 401);
  assert.equal(messages.statusCode, 401);
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

  assert.deepEqual(me.json(), { email: 'dev@publicidadsegmentadatv.com', role: 'commercial' });
  assert.equal(users.statusCode, 403);
});

test('cambiar de cuenta elimina la cookie anterior y redirige a OAuth', async () => {
  const response = await app.inject({ method: 'GET', url: '/auth/switch' });

  assert.equal(response.statusCode, 302);
  assert.equal(response.headers.location, '/auth/google');
  assert.match(response.headers['set-cookie'] ?? '', /Max-Age=0/);
});
