import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';
import { getMysqlPool, isMysqlEnabled, mysqlDateTime } from './mysql.js';
import { defaultOrganizationId, ensureDefaultOrganization } from './organization-store.js';
import { normalizeAiProvider } from './ai-models.js';
import type { AiProvider } from './ai-connections.js';

export type UserRole = 'commercial' | 'admin';
export type UserAccessStatus = 'active' | 'pending' | 'revoked';

export type AppUser = {
  email: string;
  organizationId: string;
  role: UserRole;
  accessStatus?: UserAccessStatus;
  aiAccessEnabled?: boolean;
  aiProvider?: AiProvider;
  aiModel?: string;
  createdAt: string;
  lastLoginAt: string;
};

const userFile = resolve(process.env.USER_STORE_FILE ?? '.data/users.json');

export async function upsertUser(email: string) {
  await ensureDefaultOrganization();
  const normalizedEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) return upsertFirestoreUser(normalizedEmail);
  if (isMysqlEnabled()) return upsertMysqlUser(normalizedEmail);

  const users = await readUsers();
  const now = new Date().toISOString();
  const existing = users.find((user) => user.email.toLowerCase() === normalizedEmail);

  if (existing) {
    if (normalizeUser(existing).accessStatus !== 'active' && !isAdminEmail(normalizedEmail)) {
      throw new Error('Esta cuenta no está autorizada por el administrador.');
    }
    existing.lastLoginAt = now;
    existing.organizationId ??= defaultOrganizationId;
    existing.role = isAdminEmail(normalizedEmail) ? 'admin' : existing.role === 'admin' ? 'commercial' : existing.role;
    existing.accessStatus = 'active';
  } else {
    if (!isAdminEmail(normalizedEmail)) throw new Error('Esta cuenta no está autorizada por el administrador.');
    users.push({
      email: normalizedEmail,
      organizationId: defaultOrganizationId,
      role: 'admin',
      accessStatus: 'active',
      createdAt: now,
      lastLoginAt: now,
    });
  }

  await writeUsers(users);
  return normalizeUser(users.find((user) => user.email.toLowerCase() === normalizedEmail)!);
}

export async function authorizeUser(email: string, role: UserRole = 'commercial', organizationId = defaultOrganizationId) {
  await ensureDefaultOrganization();
  const normalizedEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) return authorizeFirestoreUser(normalizedEmail, role, organizationId);
  if (isMysqlEnabled()) return authorizeMysqlUser(normalizedEmail, role, organizationId);

  const users = await readUsers();
  const now = new Date().toISOString();
  const existing = users.find((user) => user.email.toLowerCase() === normalizedEmail);
  if (existing) {
    existing.email = normalizedEmail;
    existing.organizationId = organizationId;
    existing.role = isAdminEmail(normalizedEmail) ? 'admin' : role;
    existing.accessStatus = 'active';
  } else {
    users.push({ email: normalizedEmail, organizationId, role: isAdminEmail(normalizedEmail) ? 'admin' : role, accessStatus: 'active', createdAt: now, lastLoginAt: now });
  }
  await writeUsers(users);
  return normalizeUser(users.find((user) => user.email.toLowerCase() === normalizedEmail)!);
}

export async function disconnectUser(email: string) {
  await ensureDefaultOrganization();
  const normalizedEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) {
    const reference = getFirestore().collection('users').doc(normalizedEmail);
    const snapshot = await reference.get();
    if (!snapshot.exists) return null;
    await reference.set({ accessStatus: 'revoked' }, { merge: true });
    return normalizeUser({ ...(snapshot.data() as AppUser), accessStatus: 'revoked' });
  }
  if (isMysqlEnabled()) {
    const pool = getMysqlPool();
    const existing = await getMysqlUser(normalizedEmail);
    if (!existing) return null;
    await pool.query('UPDATE users SET access_status = ? WHERE email = ?', ['revoked', normalizedEmail]);
    return { ...existing, accessStatus: 'revoked' as const };
  }

  const users = await readUsers();
  const existing = users.find((user) => user.email.toLowerCase() === normalizedEmail);
  if (!existing) return null;
  existing.accessStatus = 'revoked';
  await writeUsers(users);
  return normalizeUser(existing);
}

export async function deleteUser(email: string) {
  await ensureDefaultOrganization();
  const normalizedEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) {
    const reference = getFirestore().collection('users').doc(normalizedEmail);
    const snapshot = await reference.get();
    if (!snapshot.exists) return null;
    await reference.delete();
    return normalizeUser(snapshot.data() as AppUser);
  }
  if (isMysqlEnabled()) {
    const pool = getMysqlPool();
    const existing = await getMysqlUser(normalizedEmail);
    if (!existing) return null;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM ai_connections WHERE user_email = ?', [normalizedEmail]);
      await connection.query('DELETE FROM gmail_actions WHERE user_email = ?', [normalizedEmail]);
      await connection.query('DELETE FROM users WHERE email = ?', [normalizedEmail]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return existing;
  }

  const users = await readUsers();
  const index = users.findIndex((user) => user.email.toLowerCase() === normalizedEmail);
  if (index < 0) return null;
  const [deleted] = users.splice(index, 1);
  await writeUsers(users);
  return normalizeUser(deleted);
}

export async function getUser(email: string) {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('users').doc(email).get();
    return snapshot.exists ? normalizeUser(snapshot.data() as AppUser) : null;
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)]);
    const row = (rows as Array<Record<string, unknown>>)[0];
    return row ? fromMysqlUser(row) : null;
  }
  const user = (await readUsers()).find((item) => item.email === email);
  return user ? normalizeUser(user) : null;
}

export async function listUsers() {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('users').orderBy('email').get();
    return snapshot.docs.map((document) => {
      const user = document.data() as AppUser;
      return { ...normalizeUser(user), organizationId: user.organizationId ?? defaultOrganizationId };
    });
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query('SELECT * FROM users ORDER BY email');
    return (rows as Array<Record<string, unknown>>).map(fromMysqlUser);
  }
  return (await readUsers()).map(normalizeUser);
}

export async function updateUserAiSettings(email: string, settings: {
  aiAccessEnabled?: boolean;
  aiProvider?: AiProvider | null;
  aiModel?: string | null;
}) {
  const normalizedEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) {
    const reference = getFirestore().collection('users').doc(normalizedEmail);
    const snapshot = await reference.get();
    if (!snapshot.exists) return null;
    const update: Record<string, unknown> = {};
    if (settings.aiAccessEnabled !== undefined) update.aiAccessEnabled = settings.aiAccessEnabled;
    if (settings.aiProvider !== undefined) update.aiProvider = settings.aiProvider;
    if (settings.aiModel !== undefined) update.aiModel = settings.aiModel;
    await reference.set(update, { merge: true });
    return normalizeUser({ ...(snapshot.data() as AppUser), ...update });
  }
  if (isMysqlEnabled()) {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (settings.aiAccessEnabled !== undefined) {
      fields.push('ai_access_enabled = ?');
      values.push(settings.aiAccessEnabled);
    }
    if (settings.aiProvider !== undefined) {
      fields.push('ai_provider = ?');
      values.push(settings.aiProvider);
    }
    if (settings.aiModel !== undefined) {
      fields.push('ai_model = ?');
      values.push(settings.aiModel);
    }
    if (fields.length) {
      values.push(normalizedEmail);
      await getMysqlPool().query(`UPDATE users SET ${fields.join(', ')} WHERE email = ?`, values);
    }
    return getMysqlUser(normalizedEmail);
  }

  const users = await readUsers();
  const user = users.find((item) => item.email.toLowerCase() === normalizedEmail);
  if (!user) return null;
  if (settings.aiAccessEnabled !== undefined) user.aiAccessEnabled = settings.aiAccessEnabled;
  if (settings.aiProvider !== undefined) {
    if (settings.aiProvider === null) delete user.aiProvider;
    else user.aiProvider = settings.aiProvider;
  }
  if (settings.aiModel !== undefined) {
    if (settings.aiModel === null) delete user.aiModel;
    else user.aiModel = settings.aiModel;
  }
  await writeUsers(users);
  return normalizeUser(user);
}

async function upsertFirestoreUser(email: string) {
  const reference = getFirestore().collection('users').doc(email);
  const snapshot = await reference.get();
  const now = new Date().toISOString();
  const role = isAdminEmail(email) ? 'admin' : 'commercial';
  const existing = snapshot.exists ? snapshot.data() as AppUser : undefined;
  if (existing && normalizeUser(existing).accessStatus !== 'active' && !isAdminEmail(email)) {
    throw new Error('Esta cuenta no está autorizada por el administrador.');
  }
  const user: AppUser = {
    email,
    organizationId: defaultOrganizationId,
    role: existing && !isAdminEmail(email) ? existing.role : role,
    accessStatus: 'active',
    createdAt: existing?.createdAt ?? now,
    lastLoginAt: now,
  };
  await reference.set(user);
  return user;
}

async function authorizeFirestoreUser(email: string, role: UserRole, organizationId: string) {
  const reference = getFirestore().collection('users').doc(email);
  const snapshot = await reference.get();
  const now = new Date().toISOString();
  const existing = snapshot.exists ? snapshot.data() as AppUser : undefined;
  const user: AppUser = {
    email,
    organizationId,
    role: isAdminEmail(email) ? 'admin' : role,
    accessStatus: 'active',
    createdAt: existing?.createdAt ?? now,
    lastLoginAt: existing?.lastLoginAt ?? now,
  };
  await reference.set(user, { merge: true });
  return user;
}

async function upsertMysqlUser(email: string) {
  const pool = getMysqlPool();
  const existing = await getMysqlUser(email);
  const now = mysqlDateTime();
  if (existing && existing.accessStatus !== 'active' && !isAdminEmail(email)) {
    throw new Error('Esta cuenta no está autorizada por el administrador.');
  }
  if (!existing && !isAdminEmail(email)) throw new Error('Esta cuenta no está autorizada por el administrador.');
  const role: UserRole = isAdminEmail(email) ? 'admin' : existing?.role ?? 'commercial';
  if (existing) {
    await pool.query(
      'UPDATE users SET role = ?, access_status = ?, last_login_at = ? WHERE email = ?',
      [role, 'active', now, email],
    );
  } else {
    await pool.query(
      `INSERT INTO users (email, organization_id, role, access_status, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email, defaultOrganizationId, role, 'active', now, now],
    );
  }
  return (await getMysqlUser(email))!;
}

async function authorizeMysqlUser(email: string, role: UserRole, organizationId: string) {
  const pool = getMysqlPool();
  const existing = await getMysqlUser(email);
  const now = mysqlDateTime();
  const nextRole: UserRole = isAdminEmail(email) ? 'admin' : role;
  if (existing) {
    await pool.query(
      'UPDATE users SET organization_id = ?, role = ?, access_status = ? WHERE email = ?',
      [organizationId, nextRole, 'active', email],
    );
  } else {
    await pool.query(
      `INSERT INTO users (email, organization_id, role, access_status, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email, organizationId, nextRole, 'active', now, now],
    );
  }
  return (await getMysqlUser(email))!;
}

async function getMysqlUser(email: string) {
  const [rows] = await getMysqlPool().query('SELECT * FROM users WHERE email = ?', [email]);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row ? fromMysqlUser(row) : null;
}

function fromMysqlUser(row: Record<string, unknown>): AppUser {
  return normalizeUser({
    email: String(row.email),
    organizationId: String(row.organization_id),
    role: row.role === 'admin' ? 'admin' : 'commercial',
    accessStatus: row.access_status === 'revoked' ? 'revoked' : row.access_status === 'pending' ? 'pending' : 'active',
    aiAccessEnabled: row.ai_access_enabled === null || row.ai_access_enabled === undefined ? undefined : Boolean(row.ai_access_enabled),
    aiProvider: normalizeAiProvider(row.ai_provider) ?? undefined,
    aiModel: typeof row.ai_model === 'string' && row.ai_model ? row.ai_model : undefined,
    createdAt: String(row.created_at),
    lastLoginAt: String(row.last_login_at),
  });
}

function normalizeUser(user: AppUser): AppUser {
  return {
    ...user,
    organizationId: user.organizationId ?? defaultOrganizationId,
    accessStatus: user.accessStatus ?? 'active',
    aiProvider: normalizeAiProvider(user.aiProvider) ?? undefined,
    aiModel: user.aiModel || undefined,
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isAdminEmail(email: string) {
  return new Set(
    (process.env.ADMIN_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  ).has(email.toLowerCase());
}

async function readUsers(): Promise<AppUser[]> {
  try {
    return JSON.parse(await readFile(userFile, 'utf8')) as AppUser[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeUsers(users: AppUser[]) {
  await mkdir(dirname(userFile), { recursive: true });
  await writeFile(userFile, JSON.stringify(users, null, 2), { encoding: 'utf8', mode: 0o600 });
}
