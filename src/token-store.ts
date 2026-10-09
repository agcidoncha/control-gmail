import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
  const key = getEncryptionKey();
  const accounts = await readAccounts();
  accounts[email] = tokens;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(accounts), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');

  await mkdir(dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, payload, { encoding: 'utf8', mode: 0o600 });
}

export async function listConnectedAccounts() {
  return Object.keys(await readAccounts());
}

export async function loadGoogleTokens(email: string) {
  const accounts = await readAccounts();
  return accounts[email] ?? null;
}

async function readAccounts(): Promise<StoredAccounts> {
  try {
    const payload = Buffer.from(await readFile(tokenFile, 'utf8'), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    const decrypted = Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(decrypted) as StoredAccounts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
