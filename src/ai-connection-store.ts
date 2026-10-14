import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';
import { getMysqlPool, isMysqlEnabled, mysqlDateTime } from './mysql.js';
import type { AiProvider } from './ai-connections.js';
import { getDefaultAiModel } from './ai-models.js';

export type PersonalAiConnection = {
  organizationId: string;
  userEmail: string;
  provider: AiProvider;
  model?: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
};

export type PersonalAiConnectionStatus = Omit<PersonalAiConnection, 'apiKey'> & { connected: true };

type StoredConnections = Record<string, PersonalAiConnection>;

const connectionFile = resolve(process.env.AI_CONNECTION_STORE_FILE ?? '.data/ai-connections.enc');

export async function savePersonalAiConnection(connection: Omit<PersonalAiConnection, 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString();
  const next: PersonalAiConnection = { ...connection, createdAt: now, updatedAt: now };
  const key = connectionKey(connection.organizationId, connection.userEmail);

  if (isFirestoreEnabled()) {
    await getFirestore().collection('ai_connections').doc(key).set({
      ...next,
      apiKey: encryptValue(next.apiKey),
    });
    return;
  }
  if (isMysqlEnabled()) {
    await getMysqlPool().query(
      `INSERT INTO ai_connections (organization_id, user_email, provider, model, api_key_ciphertext, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE provider = VALUES(provider), model = VALUES(model), api_key_ciphertext = VALUES(api_key_ciphertext), updated_at = VALUES(updated_at)`,
      [next.organizationId, next.userEmail.toLowerCase(), next.provider, next.model ?? getDefaultAiModel(next.provider), encryptValue(next.apiKey), mysqlDateTime(next.createdAt), mysqlDateTime(next.updatedAt)],
    );
    return;
  }

  const connections = await readConnections();
  connections[key] = next;
  await writeConnections(connections);
}

export async function loadPersonalAiConnection(organizationId: string, userEmail: string): Promise<PersonalAiConnection | null> {
  const key = connectionKey(organizationId, userEmail);
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('ai_connections').doc(key).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() as PersonalAiConnection & { apiKey: string };
    return { ...data, apiKey: decryptValue(data.apiKey) };
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query(
      'SELECT * FROM ai_connections WHERE organization_id = ? AND user_email = ?',
      [organizationId, userEmail.toLowerCase()],
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) return null;
    return {
      organizationId: String(row.organization_id),
      userEmail: String(row.user_email),
      provider: row.provider === 'claude' ? 'claude' : row.provider === 'deepseek' ? 'deepseek' : 'openai',
      model: typeof row.model === 'string' && row.model ? row.model : getDefaultAiModel(row.provider === 'claude' ? 'claude' : row.provider === 'deepseek' ? 'deepseek' : 'openai'),
      apiKey: decryptValue(String(row.api_key_ciphertext)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
  const connections = await readConnections();
  return connections[key] ?? null;
}

export async function getPersonalAiConnectionStatus(organizationId: string, userEmail: string): Promise<PersonalAiConnectionStatus | null> {
  const connection = await loadPersonalAiConnection(organizationId, userEmail);
  if (!connection) return null;
  const { apiKey: _apiKey, ...status } = connection;
  return { ...status, connected: true };
}

export async function deletePersonalAiConnection(organizationId: string, userEmail: string) {
  const key = connectionKey(organizationId, userEmail);
  if (isFirestoreEnabled()) {
    await getFirestore().collection('ai_connections').doc(key).delete();
    return;
  }
  if (isMysqlEnabled()) {
    await getMysqlPool().query(
      'DELETE FROM ai_connections WHERE organization_id = ? AND user_email = ?',
      [organizationId, userEmail.toLowerCase()],
    );
    return;
  }

  const connections = await readConnections();
  delete connections[key];
  await writeConnections(connections);
}

function connectionKey(organizationId: string, userEmail: string) {
  return `${organizationId}:${userEmail.toLowerCase()}`;
}

function getEncryptionKey() {
  const value = process.env.AI_CONNECTION_ENCRYPTION_KEY ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('AI_CONNECTION_ENCRYPTION_KEY debe ser una clave hexadecimal de 64 caracteres.');
  }
  return Buffer.from(value, 'hex');
}

function encryptValue(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptValue(payload: string) {
  const encoded = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), encoded.subarray(0, 12));
  decipher.setAuthTag(encoded.subarray(12, 28));
  return Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString('utf8');
}

async function readConnections(): Promise<StoredConnections> {
  try {
    const stored = JSON.parse(await readFile(connectionFile, 'utf8')) as StoredConnections;
    return Object.fromEntries(Object.entries(stored).map(([key, connection]) => [
      key,
      { ...connection, apiKey: decryptValue(connection.apiKey) },
    ]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeConnections(connections: StoredConnections) {
  await mkdir(dirname(connectionFile), { recursive: true });
  const payload = Object.fromEntries(Object.entries(connections).map(([key, connection]) => [
    key,
    { ...connection, apiKey: encryptValue(connection.apiKey) },
  ]));
  await writeFile(connectionFile, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
}
