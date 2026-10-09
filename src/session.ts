import { createHmac, timingSafeEqual } from 'node:crypto';

const sessionCookie = 'control_gmail_session';
const sessionLifetimeSeconds = 60 * 60 * 8;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  }
  return secret;
}

function sign(value: string) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

export function createSession(email: string) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + sessionLifetimeSeconds,
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

export function readSession(cookieHeader?: string) {
  const cookie = cookieHeader?.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(`${sessionCookie}=`));
  if (!cookie) return null;

  const value = cookie.slice(`${sessionCookie}=`.length);
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string; exp?: number };
    if (!data.email || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.email;
  } catch {
    return null;
  }
}

export function sessionCookieHeader(email: string) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${sessionCookie}=${createSession(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}${secure}`;
}

export function clearSessionCookieHeader() {
  return `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
