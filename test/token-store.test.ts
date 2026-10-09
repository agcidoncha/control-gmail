import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'control-gmail-tokens-'));
process.env.TOKEN_STORE_FILE = join(directory, 'tokens.enc');
process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

const { listConnectedAccounts, loadGoogleTokens, saveGoogleTokens } = await import('../src/token-store.ts?token-store-test');

test.after(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('guarda tokens separados y cifrados por cuenta', async () => {
  await saveGoogleTokens('angel.cidoncha@gmail.com', { refresh_token: 'angel-secret-token' });
  await saveGoogleTokens('dev@publicidadsegmentadatv.com', { refresh_token: 'dev-secret-token' });

  assert.deepEqual(await loadGoogleTokens('angel.cidoncha@gmail.com'), { refresh_token: 'angel-secret-token' });
  assert.deepEqual(await loadGoogleTokens('dev@publicidadsegmentadatv.com'), { refresh_token: 'dev-secret-token' });
  assert.deepEqual(await listConnectedAccounts(), [
    'angel.cidoncha@gmail.com',
    'dev@publicidadsegmentadatv.com',
  ]);

  const encryptedFile = await readFile(process.env.TOKEN_STORE_FILE!, 'utf8');
  assert.doesNotMatch(encryptedFile, /angel-secret-token|dev-secret-token/);
});
