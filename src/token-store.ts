import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getFirestore, isFirestoreEnabled } from './firestore.js';

type GoogleTokens = Record<string, unknown>;
type StoredAccounts = Record<string, GoogleTokens>;

const tokenFile = resolve(process.env.TOKEN_STORE_FILE ?? '.data/google-tokens.enc');

function getEncryptionKey() {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('TOKEN_ENCRYPTION_KEY debe ser una clave hexadecimal de 64 caracteres.');
  }

  return Buffer.from(value, 'hex');
}

export async function saveGoogleTokens(email: string, tokens: GoogleTokens) {
  if (isFirestoreEnabled()) {
    await getFirestore().collection('google_tokens').doc(email).set({
      email,
      payload: encryptPayload(tokens),
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const accounts = await readAccounts();
  accounts[email] = tokens;

  const payload = encryptPayload(accounts);

  await mkdir(dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, payload, { encoding: 'utf8', mode: 0o600 });
}

export async function listConnectedAccounts() {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('google_tokens').select('email').get();
    return snapshot.docs.map((document) => document.data().email as string).sort();
  }
  return Object.keys(await readAccounts());
}

export async function loadGoogleTokens(email: string) {
  if (isFirestoreEnabled()) {
    const snapshot = await getFirestore().collection('google_tokens').doc(email).get();
    if (!snapshot.exists) return null;
    const payload = snapshot.data()?.payload;
    return typeof payload === 'string' ? decryptPayload(payload) as GoogleTokens : null;
  }
  const accounts = await readAccounts();
  return accounts[email] ?? null;
}

function encryptPayload(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function decryptPayload(payload: string) {
  const encoded = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), encoded.subarray(0, 12));
  decipher.setAuthTag(encoded.subarray(12, 28));
  return JSON.parse(Buffer.concat([
    decipher.update(encoded.subarray(28)),
    decipher.final(),
  ]).toString('utf8')) as unknown;
}

async function readAccounts(): Promise<StoredAccounts> {
  try {
    return decryptPayload(await readFile(tokenFile, 'utf8')) as StoredAccounts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
