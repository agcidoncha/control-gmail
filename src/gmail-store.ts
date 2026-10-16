import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';
import { getMysqlPool, isMysqlEnabled, mysqlDateTime } from './mysql.js';

export type StoredMailbox = 'inbox' | 'sent' | 'spam';

export type StoredGmailMessage = {
  id: string;
  threadId: string | null;
  accountEmail: string;
  mailbox: StoredMailbox;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  sortTimestamp: number;
  snippet: string;
  labelIds: string[];
  important: boolean;
  bounced: boolean;
  syncedAt: string;
};

export type StoredThreadMessage = {
  id: string | null;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  internalDate: number | null;
  body: string;
  dateHints: string[];
};

export type GmailSyncState = {
  queryVersion?: number;
  accountEmail: string;
  from: string;
  to: string;
  lastSyncedAt: string;
  messageCount: number;
  threadCount: number;
  truncated: boolean;
  historyId?: string;
};

type PersistedThreadMessage = Omit<StoredThreadMessage, 'body'> & { bodyCiphertext: string };
type PersistedThread = {
  accountEmail: string;
  threadId: string;
  messages: PersistedThreadMessage[];
  updatedAt: string;
};

type LocalAccount = {
  messages: Record<string, StoredGmailMessage>;
  threads: Record<string, PersistedThread>;
  syncState?: GmailSyncState;
};

type LocalStore = { accounts: Record<string, LocalAccount> };

const storeFile = resolve(process.env.GMAIL_STORE_FILE ?? '.data/gmail-store.json');

export async function getGmailSyncState(email: string): Promise<GmailSyncState | null> {
  const accountEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('gmail_accounts').doc(accountEmail).get();
    return snapshot.exists ? (snapshot.data()?.syncState as GmailSyncState | undefined) ?? null : null;
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query('SELECT sync_state FROM gmail_accounts WHERE account_email = ?', [accountEmail]);
    const value = (rows as Array<Record<string, unknown>>)[0]?.sync_state;
    return value ? parseJson(value) as GmailSyncState : null;
  }

  const store = await readLocalStore();
  return store.accounts[accountKey(accountEmail)]?.syncState ?? null;
}

export async function saveGmailSyncSnapshot(input: {
  email: string;
  messages: StoredGmailMessage[];
  threads: StoredThreadMessage[][];
  syncState: GmailSyncState;
  removedMessageIds?: string[];
}) {
  const accountEmail = normalizeEmail(input.email);
  const updatedAt = new Date().toISOString();

  if (isFirestoreEnabled()) {
    const accountRef = getFirestore().collection('gmail_accounts').doc(accountEmail);
    await accountRef.set({
      accountEmail,
      syncState: input.syncState,
      updatedAt,
    }, { merge: true });

    const batch = getFirestore().batch();
    input.messages.forEach((message) => {
      const reference = accountRef.collection('messages').doc(message.id);
      batch.set(reference, { ...message, accountEmail }, { merge: true });
    });
    input.removedMessageIds?.forEach((messageId) => {
      batch.delete(accountRef.collection('messages').doc(messageId));
    });
    input.threads.forEach((messages) => {
      const threadId = messages[0]?.threadId;
      if (!threadId) return;
      const reference = accountRef.collection('threads').doc(threadId);
      batch.set(reference, {
        accountEmail,
        threadId,
        messages: messages.map(toPersistedThreadMessage),
        updatedAt,
      }, { merge: true });
    });
    await batch.commit();
    return;
  }

  if (isMysqlEnabled()) {
    const connection = await getMysqlPool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO gmail_accounts (account_email, organization_id, sync_state, updated_at)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE sync_state = VALUES(sync_state), updated_at = VALUES(updated_at)`,
        [accountEmail, process.env.DEFAULT_ORGANIZATION_ID ?? 'org_publicidad_segmentada_tv', JSON.stringify(input.syncState), mysqlDateTime(updatedAt)],
      );
      for (const message of input.messages) {
        await connection.query(
          `INSERT INTO gmail_messages
            (account_email, message_id, thread_id, mailbox, subject, sender, recipients, message_date, sort_timestamp, snippet, label_ids, important, bounced, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
            thread_id = VALUES(thread_id), mailbox = VALUES(mailbox), subject = VALUES(subject), sender = VALUES(sender),
            recipients = VALUES(recipients), message_date = VALUES(message_date), sort_timestamp = VALUES(sort_timestamp),
            snippet = VALUES(snippet), label_ids = VALUES(label_ids), important = VALUES(important), bounced = VALUES(bounced), synced_at = VALUES(synced_at)`,
          [accountEmail, message.id, message.threadId, message.mailbox, message.subject, message.from, message.to, message.date, message.sortTimestamp, message.snippet, JSON.stringify(message.labelIds), message.important, message.bounced, mysqlDateTime(message.syncedAt)],
        );
      }
      for (const messageId of input.removedMessageIds ?? []) {
        await connection.query('DELETE FROM gmail_messages WHERE account_email = ? AND message_id = ?', [accountEmail, messageId]);
      }
      for (const messages of input.threads) {
        const threadId = messages[0]?.threadId;
        if (!threadId) continue;
        await connection.query(
          `INSERT INTO gmail_threads (account_email, thread_id, messages_ciphertext, updated_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE messages_ciphertext = VALUES(messages_ciphertext), updated_at = VALUES(updated_at)`,
          [accountEmail, threadId, JSON.stringify(messages.map(toPersistedThreadMessage)), mysqlDateTime(updatedAt)],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return;
  }

  const store = await readLocalStore();
  const account = store.accounts[accountKey(accountEmail)] ?? { messages: {}, threads: {} };
  input.messages.forEach((message) => {
    account.messages[message.id] = { ...message, accountEmail };
  });
  input.removedMessageIds?.forEach((messageId) => {
    delete account.messages[messageId];
  });
  input.threads.forEach((messages) => {
    const threadId = messages[0]?.threadId;
    if (!threadId) return;
    account.threads[threadId] = {
      accountEmail,
      threadId,
      messages: messages.map(toPersistedThreadMessage),
      updatedAt,
    };
  });
  account.syncState = input.syncState;
  store.accounts[accountKey(accountEmail)] = account;
  await writeLocalStore(store);
}

export async function listStoredGmailMessages(
  email: string,
  mailbox: StoredMailbox,
  limit: number,
  offset = 0,
) {
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query(
      'SELECT * FROM gmail_messages WHERE account_email = ? AND mailbox = ? ORDER BY sort_timestamp DESC LIMIT ? OFFSET ?',
      [normalizeEmail(email), mailbox, Math.min(Math.max(limit, 1), 50), Math.max(offset, 0)],
    );
    const messages = (rows as Array<Record<string, unknown>>).map(fromMysqlMessage);
    return { messages, nextOffset: messages.length === Math.min(Math.max(limit, 1), 50) ? offset + messages.length : null };
  }
  const messages = await allStoredMessages(email);
  const filtered = messages
    .filter((message) => message.mailbox === mailbox)
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp);
  const page = filtered.slice(Math.max(offset, 0), Math.max(offset, 0) + Math.min(Math.max(limit, 1), 50));
  const nextOffset = offset + page.length < filtered.length ? offset + page.length : null;
  return { messages: page, nextOffset };
}

export async function getStoredGmailThread(email: string, threadId: string): Promise<StoredThreadMessage[] | null> {
  const accountEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore()
      .collection('gmail_accounts')
      .doc(accountEmail)
      .collection('threads')
      .doc(threadId)
      .get();
    if (!snapshot.exists) return null;
    const messages = (snapshot.data()?.messages ?? []) as PersistedThreadMessage[];
    return messages.map(fromPersistedThreadMessage);
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query(
      'SELECT messages_ciphertext FROM gmail_threads WHERE account_email = ? AND thread_id = ?',
      [accountEmail, threadId],
    );
    const payload = (rows as Array<Record<string, unknown>>)[0]?.messages_ciphertext;
    if (typeof payload !== 'string') return null;
    const messages = parseJson(payload) as PersistedThreadMessage[];
    return messages.map(fromPersistedThreadMessage);
  }

  const store = await readLocalStore();
  const thread = store.accounts[accountKey(accountEmail)]?.threads[threadId];
  return thread ? thread.messages.map(fromPersistedThreadMessage) : null;
}

export async function findStoredGmailMessages(email: string, clientEmail: string, limit = 50) {
  const normalizedClient = clientEmail.trim().toLowerCase();
  const messages = await allStoredMessages(email);
  return messages
    .filter((message) => `${message.from} ${message.to}`.toLowerCase().includes(normalizedClient))
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp)
    .slice(0, Math.min(Math.max(limit, 1), 100));
}

export async function listAllStoredGmailMessages(email: string, mailbox: StoredMailbox) {
  return (await allStoredMessages(email))
    .filter((message) => message.mailbox === mailbox)
    .sort((left, right) => right.sortTimestamp - left.sortTimestamp);
}

async function allStoredMessages(email: string): Promise<StoredGmailMessage[]> {
  const accountEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('gmail_accounts').doc(accountEmail).collection('messages').get();
    return snapshot.docs.map((document) => document.data() as StoredGmailMessage);
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query('SELECT * FROM gmail_messages WHERE account_email = ?', [accountEmail]);
    return (rows as Array<Record<string, unknown>>).map(fromMysqlMessage);
  }

  const store = await readLocalStore();
  return Object.values(store.accounts[accountKey(accountEmail)]?.messages ?? {});
}

function fromMysqlMessage(row: Record<string, unknown>): StoredGmailMessage {
  return {
    id: String(row.message_id),
    threadId: row.thread_id ? String(row.thread_id) : null,
    accountEmail: String(row.account_email),
    mailbox: row.mailbox === 'sent' ? 'sent' : row.mailbox === 'spam' ? 'spam' : 'inbox',
    subject: String(row.subject ?? ''),
    from: String(row.sender ?? ''),
    to: String(row.recipients ?? ''),
    date: row.message_date ? String(row.message_date) : null,
    sortTimestamp: Number(row.sort_timestamp),
    snippet: String(row.snippet ?? ''),
    labelIds: parseJson(row.label_ids) as string[],
    important: Boolean(row.important),
    bounced: Boolean(row.bounced),
    syncedAt: String(row.synced_at),
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toPersistedThreadMessage(message: StoredThreadMessage): PersistedThreadMessage {
  const { body, ...metadata } = message;
  return { ...metadata, bodyCiphertext: encryptBody(body) };
}

function fromPersistedThreadMessage(message: PersistedThreadMessage): StoredThreadMessage {
  const { bodyCiphertext, ...metadata } = message;
  return { ...metadata, body: decryptBody(bodyCiphertext) };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function accountKey(email: string) {
  return encodeURIComponent(email);
}

function getEncryptionKey() {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('TOKEN_ENCRYPTION_KEY debe ser una clave hexadecimal de 64 caracteres.');
  }
  return Buffer.from(value, 'hex');
}

function encryptBody(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptBody(payload: string) {
  const encoded = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), encoded.subarray(0, 12));
  decipher.setAuthTag(encoded.subarray(12, 28));
  return Buffer.concat([
    decipher.update(encoded.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}

async function readLocalStore(): Promise<LocalStore> {
  try {
    const value = JSON.parse(await readFile(storeFile, 'utf8')) as LocalStore;
    return { accounts: value.accounts ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { accounts: {} };
    throw error;
  }
}

async function writeLocalStore(store: LocalStore) {
  await mkdir(dirname(storeFile), { recursive: true });
  await writeFile(storeFile, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}
