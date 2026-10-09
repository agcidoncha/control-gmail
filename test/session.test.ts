import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-chars';

const { createSession, readSession, sessionCookieHeader } = await import('../src/session.ts');

test('una sesión válida identifica únicamente a su cuenta', () => {
  const session = createSession('dev@publicidadsegmentadatv.com');

  assert.equal(readSession(`control_gmail_session=${session}`), 'dev@publicidadsegmentadatv.com');
  assert.equal(readSession(`other=value; control_gmail_session=${session}`), 'dev@publicidadsegmentadatv.com');
});

test('una sesión manipulada o ausente se rechaza', () => {
  const session = createSession('angel.cidoncha@gmail.com');
  const [payload] = session.split('.');

  assert.equal(readSession(undefined), null);
  assert.equal(readSession('control_gmail_session=invalid'), null);
  assert.equal(readSession(`control_gmail_session=${payload}.tampered`), null);
});

test('la cookie de sesión es HttpOnly y expira automáticamente', () => {
  const header = sessionCookieHeader('angel.cidoncha@gmail.com');

  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=28800/);
});
