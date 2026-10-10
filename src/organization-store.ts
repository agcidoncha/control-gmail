import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';

export const defaultOrganizationId = process.env.DEFAULT_ORGANIZATION_ID ?? 'org_publicidad_segmentada_tv';
export const defaultOrganizationName = process.env.DEFAULT_ORGANIZATION_NAME ?? 'Publicidad Segmentada TV';

export type Organization = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
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
    return snapshot.exists ? snapshot.data() as Organization : null;
  }
  return (await readOrganizations()).find((organization) => organization.id === id) ?? null;
}

export async function listOrganizations(): Promise<Organization[]> {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('organizations').orderBy('name').get();
    return snapshot.docs.map((document) => document.data() as Organization);
  }
  return (await readOrganizations()).sort((left, right) => left.name.localeCompare(right.name));
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
