import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';
import { getMysqlPool, isMysqlEnabled } from './mysql.js';

export const defaultOrganizationId = process.env.DEFAULT_ORGANIZATION_ID ?? 'org_publicidad_segmentada_tv';
export const defaultOrganizationName = process.env.DEFAULT_ORGANIZATION_NAME ?? 'Publicidad Segmentada TV';

export type Organization = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
  sharedAiProvider?: 'openai' | 'claude';
  sharedAiUserEmails?: string[];
};

const organizationFile = resolve(process.env.ORGANIZATION_STORE_FILE ?? '.data/organizations.json');

export async function ensureDefaultOrganization(): Promise<Organization> {
  const existing = await getOrganization(defaultOrganizationId);
  if (existing) return existing;

  const organization: Organization = {
    id: defaultOrganizationId,
    name: defaultOrganizationName,
    status: 'active',
    createdAt: new Date().toISOString(),
  };

  if (isFirestoreEnabled()) {
    await getFirestore().collection('organizations').doc(organization.id).set(organization);
  } else if (isMysqlEnabled()) {
    await getMysqlPool().query(
      `INSERT INTO organizations (id, name, status, shared_ai_user_emails, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = VALUES(id)`,
      [organization.id, organization.name, organization.status, JSON.stringify([]), organization.createdAt],
    );
  } else {
    const organizations = await readOrganizations();
    organizations.push(organization);
    await writeOrganizations(organizations);
  }

  return organization;
}

export async function getOrganization(id: string): Promise<Organization | null> {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('organizations').doc(id).get();
    return snapshot.exists ? normalizeOrganization(snapshot.data() as Organization) : null;
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query('SELECT * FROM organizations WHERE id = ?', [id]);
    const row = (rows as Array<Record<string, unknown>>)[0];
    return row ? normalizeOrganization(fromMysqlOrganization(row)) : null;
  }
  const organization = (await readOrganizations()).find((item) => item.id === id);
  return organization ? normalizeOrganization(organization) : null;
}

export async function listOrganizations(): Promise<Organization[]> {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('organizations').orderBy('name').get();
    return snapshot.docs.map((document) => normalizeOrganization(document.data() as Organization));
  }
  if (isMysqlEnabled()) {
    const [rows] = await getMysqlPool().query('SELECT * FROM organizations ORDER BY name');
    return (rows as Array<Record<string, unknown>>).map((row) => normalizeOrganization(fromMysqlOrganization(row)));
  }
  return (await readOrganizations()).map(normalizeOrganization).sort((left, right) => left.name.localeCompare(right.name));
}

export async function updateOrganizationAiSettings(id: string, settings: { provider?: 'openai' | 'claude'; sharedAiUserEmails?: string[] }) {
  const nextEmails = [...new Set((settings.sharedAiUserEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (isFirestoreEnabled()) {
    const update: Record<string, unknown> = { sharedAiUserEmails: nextEmails };
    if (settings.provider) update.sharedAiProvider = settings.provider;
    await getFirestore().collection('organizations').doc(id).set(update, { merge: true });
    return getOrganization(id);
  }

  if (isMysqlEnabled()) {
    const fields: string[] = ['shared_ai_user_emails = ?'];
    const values: unknown[] = [JSON.stringify(nextEmails)];
    if (settings.provider) {
      fields.push('shared_ai_provider = ?');
      values.push(settings.provider);
    }
    values.push(id);
    await getMysqlPool().query(`UPDATE organizations SET ${fields.join(', ')} WHERE id = ?`, values);
    return getOrganization(id);
  }

  const organizations = await readOrganizations();
  const organization = organizations.find((item) => item.id === id);
  if (!organization) return null;
  organization.sharedAiUserEmails = nextEmails;
  if (settings.provider) organization.sharedAiProvider = settings.provider;
  await writeOrganizations(organizations);
  return normalizeOrganization(organization);
}

function normalizeOrganization(organization: Organization): Organization {
  return {
    ...organization,
    sharedAiUserEmails: [...new Set((organization.sharedAiUserEmails ?? []).map((email) => email.toLowerCase()))],
  };
}

function fromMysqlOrganization(row: Record<string, unknown>): Organization {
  return {
    id: String(row.id),
    name: String(row.name),
    status: row.status === 'suspended' ? 'suspended' : 'active',
    createdAt: String(row.created_at),
    sharedAiProvider: row.shared_ai_provider === 'claude' ? 'claude' : row.shared_ai_provider === 'openai' ? 'openai' : undefined,
    sharedAiUserEmails: parseEmailList(row.shared_ai_user_emails),
  };
}

function parseEmailList(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function readOrganizations(): Promise<Organization[]> {
  try {
    return JSON.parse(await readFile(organizationFile, 'utf8')) as Organization[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeOrganizations(organizations: Organization[]) {
  await mkdir(dirname(organizationFile), { recursive: true });
  await writeFile(organizationFile, JSON.stringify(organizations, null, 2), { encoding: 'utf8', mode: 0o600 });
}
