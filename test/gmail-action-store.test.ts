import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';

const directory = await mkdtemp(join(tmpdir(), 'control-gmail-actions-'));
process.env.DATA_STORE = 'local';
process.env.GMAIL_ACTION_STORE_FILE = join(directory, 'actions.json');

const { listGmailActions, recordGmailAction } = await import('../src/gmail-action-store.ts?action-store-test');

test('registra acciones sin guardar contenido del correo y filtra por cuenta', async () => {
  await recordGmailAction({
    organizationId: 'org-test',
    userEmail: 'comercial@example.com',
    accountEmail: 'comercial@example.com',
    messageId: 'message-1',
    action: 'archive',
    outcome: 'success',
  });
  await recordGmailAction({
    organizationId: 'org-test',
    userEmail: 'otro@example.com',
    accountEmail: 'otro@example.com',
    messageId: 'message-2',
    action: 'archive',
    outcome: 'success',
  });

  const actions = await listGmailActions({
    organizationId: 'org-test',
    userEmail: 'comercial@example.com',
    accountEmail: 'comercial@example.com',
    action: 'archive',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].messageId, 'message-1');
  const raw = await readFile(process.env.GMAIL_ACTION_STORE_FILE!, 'utf8');
  assert.equal(raw.includes('subject'), false);
  assert.equal(raw.includes('body'), false);

  const organizationActions = await listGmailActions({
    organizationId: 'org-test',
    allUsers: true,
  });
  assert.equal(organizationActions.length, 2);
  assert.deepEqual(new Set(organizationActions.map((action) => action.userEmail)), new Set(['comercial@example.com', 'otro@example.com']));
});
