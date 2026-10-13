import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';
import { getMysqlPool, isMysqlEnabled, mysqlDateTime } from './mysql.js';

export type GmailActionName = 'markRead' | 'markUnread' | 'archive' | 'unarchive' | 'trash' | 'restore' | 'send';
export type GmailActionOutcome = 'success' | 'error';

export type GmailActionRecord = {
  id: string;
  organizationId: string;
  userEmail: string;
  accountEmail: string;
  messageId: string;
  action: GmailActionName;
  outcome: GmailActionOutcome;
  errorCode?: string;
  createdAt: string;
};

const actionFile = resolve(process.env.GMAIL_ACTION_STORE_FILE ?? '.data/gmail-actions.json');

export async function recordGmailAction(input: Omit<GmailActionRecord, 'id' | 'createdAt'>) {
  const record: GmailActionRecord = {
    ...input,
    id: randomUUID(),
    organizationId: input.organizationId,
    userEmail: input.userEmail.toLowerCase(),
    accountEmail: input.accountEmail.toLowerCase(),
    createdAt: new Date().toISOString(),
  };

  if (isFirestoreEnabled()) {
    await getFirestore().collection('gmail_actions').doc(record.id).set(record);
    return record;
  }

  if (isMysqlEnabled()) {
    await getMysqlPool().query(
      `INSERT INTO gmail_actions
        (id, organization_id, user_email, account_email, message_id, action, outcome, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.id, record.organizationId, record.userEmail, record.accountEmail, record.messageId, record.action, record.outcome, record.errorCode ?? null, mysqlDateTime(record.createdAt)],
    );
    return record;
  }

  const records = await readActions();
  records.push(record);
  await writeActions(records);
  return record;
}

export async function listGmailActions(input: {
  organizationId: string;
  userEmail: string;
  accountEmail?: string;
  action?: GmailActionName;
  outcome?: GmailActionOutcome;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
  const userEmail = input.userEmail.toLowerCase();
  const accountEmail = input.accountEmail?.toLowerCase();

  if (isFirestoreEnabled()) {
    let query = getFirestore()
      .collection('gmail_actions')
      .where('organizationId', '==', input.organizationId)
      .where('userEmail', '==', userEmail)
      .orderBy('createdAt', 'desc')
      .limit(limit);
    if (accountEmail) query = query.where('accountEmail', '==', accountEmail) as typeof query;
    if (input.action) query = query.where('action', '==', input.action) as typeof query;
    if (input.outcome) query = query.where('outcome', '==', input.outcome) as typeof query;
    const snapshot = await query.get();
    return snapshot.docs.map((document) => document.data() as GmailActionRecord);
  }

  if (isMysqlEnabled()) {
    const conditions = ['organization_id = ?', 'user_email = ?'];
    const values: unknown[] = [input.organizationId, userEmail];
    if (accountEmail) { conditions.push('account_email = ?'); values.push(accountEmail); }
    if (input.action) { conditions.push('action = ?'); values.push(input.action); }
    if (input.outcome) { conditions.push('outcome = ?'); values.push(input.outcome); }
    values.push(limit);
    const [rows] = await getMysqlPool().query(
      `SELECT * FROM gmail_actions WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
      values,
    );
    return (rows as Array<Record<string, unknown>>).map(fromMysqlAction);
  }

  const records = await readActions();
  return records
    .filter((record) => record.organizationId === input.organizationId)
    .filter((record) => record.userEmail === userEmail)
    .filter((record) => !accountEmail || record.accountEmail === accountEmail)
    .filter((record) => !input.action || record.action === input.action)
    .filter((record) => !input.outcome || record.outcome === input.outcome)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

async function readActions(): Promise<GmailActionRecord[]> {
  try {
    return JSON.parse(await readFile(actionFile, 'utf8')) as GmailActionRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeActions(records: GmailActionRecord[]) {
  await mkdir(dirname(actionFile), { recursive: true });
  await writeFile(actionFile, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function fromMysqlAction(row: Record<string, unknown>): GmailActionRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userEmail: String(row.user_email),
    accountEmail: String(row.account_email),
    messageId: String(row.message_id),
    action: String(row.action) as GmailActionName,
    outcome: String(row.outcome) as GmailActionOutcome,
    errorCode: row.error_code ? String(row.error_code) : undefined,
    createdAt: String(row.created_at),
  };
}
