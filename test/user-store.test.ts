import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'control-gmail-users-'));
process.env.USER_STORE_FILE = join(directory, 'users.json');
process.env.ADMIN_EMAILS = 'angel.cidoncha@gmail.com';

const { authorizeUser, getUser, listUsers, upsertUser } = await import('../src/user-store.ts?user-store-test');

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('asigna administrador y comercial de forma independiente', async () => {
  await upsertUser('angel.cidoncha@gmail.com');
  await authorizeUser('dev@publicidadsegmentadatv.com');

  assert.equal((await getUser('angel.cidoncha@gmail.com'))?.role, 'admin');
  assert.equal((await getUser('dev@publicidadsegmentadatv.com'))?.role, 'commercial');
  assert.deepEqual((await listUsers()).map((user) => user.email), [
    'angel.cidoncha@gmail.com',
    'dev@publicidadsegmentadatv.com',
  ]);
});

test('rechaza cuentas que no hayan sido autorizadas por el administrador', async () => {
  await assert.rejects(
    () => upsertUser('otra-cuenta@gmail.com'),
    /no está autorizada por el administrador/,
  );
});

test('un usuario existente pierde el rol admin si deja de estar configurado', async () => {
  process.env.ADMIN_EMAILS = '';
  await upsertUser('angel.cidoncha@gmail.com');

  assert.equal((await getUser('angel.cidoncha@gmail.com'))?.role, 'commercial');
});
