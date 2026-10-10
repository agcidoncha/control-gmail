import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';
import { defaultOrganizationId, ensureDefaultOrganization } from './organization-store.js';

export type UserRole = 'commercial' | 'admin';
export type UserAccessStatus = 'active' | 'pending' | 'revoked';

export type AppUser = {
  email: string;
  organizationId: string;
  role: UserRole;
  accessStatus?: UserAccessStatus;
  createdAt: string;
  lastLoginAt: string;
};

const userFile = resolve(process.env.USER_STORE_FILE ?? '.data/users.json');

export async function upsertUser(email: string) {
  await ensureDefaultOrganization();
  const normalizedEmail = normalizeEmail(email);
  if (isFirestoreEnabled()) return upsertFirestoreUser(normalizedEmail);

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

export async function getUser(email: string) {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('users').doc(email).get();
    return snapshot.exists ? normalizeUser(snapshot.data() as AppUser) : null;
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
  return (await readUsers()).map(normalizeUser);
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

function normalizeUser(user: AppUser): AppUser {
  return { ...user, organizationId: user.organizationId ?? defaultOrganizationId, accessStatus: user.accessStatus ?? 'active' };
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
