import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type UserRole = 'commercial' | 'admin';

export type AppUser = {
  email: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string;
};

const userFile = resolve(process.env.USER_STORE_FILE ?? '.data/users.json');

export async function upsertUser(email: string) {
  const users = await readUsers();
  const now = new Date().toISOString();
  const existing = users.find((user) => user.email === email);
  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  );

  if (existing) {
    existing.lastLoginAt = now;
    existing.role = adminEmails.has(email.toLowerCase()) ? 'admin' : 'commercial';
  } else {
    users.push({
      email,
      role: adminEmails.has(email.toLowerCase()) ? 'admin' : 'commercial',
      createdAt: now,
      lastLoginAt: now,
    });
  }

  await writeUsers(users);
  return users.find((user) => user.email === email)!;
}

export async function getUser(email: string) {
  return (await readUsers()).find((user) => user.email === email) ?? null;
}

export async function listUsers() {
  return (await readUsers()).map(({ email, role, createdAt, lastLoginAt }) => ({
    email,
    role,
    createdAt,
    lastLoginAt,
  }));
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
