import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { google } from 'googleapis';

process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/google/callback';
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const dataDirectory = await mkdtemp(join(tmpdir(), 'control-gmail-google-mock-'));
process.env.TOKEN_STORE_FILE = join(dataDirectory, 'tokens.enc');
process.env.GMAIL_STORE_FILE = join(dataDirectory, 'gmail-store.json');

const account = 'mock-commercial@empresa.test';
const client = 'cliente@empresa.test';
const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const capturedQueries: string[] = [];
const capturedActions: Array<{ type: string; id: string; body?: unknown }> = [];
const capturedSends: Array<{ raw: string; threadId?: string }> = [];
let historyCalls = 0;

const messages = {
  inbox: {
    id: 'message-inbox',
    threadId: 'thread-client',
    labelIds: ['INBOX'],
    subject: 'Consulta de proyecto',
    from: `Cliente Demo <${client}>`,
    to: account,
    date: 'Thu, 08 Oct 2026 10:00:00 +0200',
    snippet: 'Necesito información para la campaña.',
  },
  sent: {
    id: 'message-sent',
    threadId: 'thread-client',
    labelIds: ['SENT'],
    subject: 'Re: Consulta de proyecto',
    from: account,
    to: `Cliente Demo <${client}>`,
    date: 'Thu, 08 Oct 2026 11:00:00 +0200',
    snippet: 'Te enviaré la propuesta mañana.',
  },
  briefing: {
    id: 'message-briefing',
    threadId: 'thread-briefing',
    labelIds: ['SENT'],
    subject: 'Briefing de campaña',
    from: account,
    to: client,
    date: 'Wed, 07 Oct 2026 09:00:00 +0200',
    snippet: 'Quedo pendiente del briefing para preparar la propuesta.',
  },
  incremental: {
    id: 'message-incremental',
    threadId: 'thread-incremental',
    labelIds: ['INBOX'],
    subject: 'Nueva consulta recibida',
    from: `Cliente Demo <${client}>`,
    to: account,
    date: 'Thu, 08 Oct 2026 12:00:00 +0200',
    snippet: 'Nueva información para actualizar la propuesta.',
  },
};

const header = (message: typeof messages.inbox) => ({
  Subject: message.subject,
  From: message.from,
  To: message.to,
  Date: message.date,
});

const fullMessage = (message: typeof messages.inbox, body: string) => ({
  id: message.id,
  threadId: message.threadId,
  internalDate: String(Date.parse(message.date)),
  payload: {
    mimeType: 'text/plain',
    body: { data: encode(body) },
    headers: Object.entries(header(message)).map(([name, value]) => ({ name, value })),
  },
});

const fakeGmail = {
  users: {
    getProfile: async () => ({ data: { emailAddress: account, historyId: historyCalls ? 'history-2' : 'history-1' } }),
    history: {
      list: async () => {
        historyCalls += 1;
        return {
          data: {
            historyId: 'history-2',
            history: [{ messagesAdded: [{ message: { id: messages.incremental.id } }] }],
          },
        };
      },
    },
    messages: {
      list: async ({ labelIds, q }: { labelIds?: string[]; q?: string }) => {
        if (q) capturedQueries.push(q);
        return {
          data: {
            messages: labelIds?.includes('INBOX')
              ? [{ id: messages.inbox.id, threadId: messages.inbox.threadId }]
              : labelIds?.includes('SENT')
              ? [{ id: messages.sent.id, threadId: messages.sent.threadId }, { id: messages.briefing.id, threadId: messages.briefing.threadId }]
              : q && (q.includes('from:') || q.includes('to:'))
              ? [{ id: messages.sent.id, threadId: messages.sent.threadId }]
              : q
              ? [{ id: messages.sent.id, threadId: messages.sent.threadId }, { id: messages.briefing.id, threadId: messages.briefing.threadId }]
              : [],
          },
        };
      },
      get: async ({ id }: { id: string }) => {
        const message = id === messages.inbox.id
          ? messages.inbox
          : id === messages.sent.id
            ? messages.sent
            : id === messages.briefing.id
              ? messages.briefing
              : messages.incremental;
        const headers = Object.entries(header(message)).map(([name, value]) => ({ name, value }));
        if (id === messages.inbox.id) headers.push({ name: 'Message-ID', value: '<inbox@example.test>' });
        return { data: { ...message, payload: { headers } } };
      },
      modify: async ({ id, requestBody }: { id: string; requestBody: unknown }) => {
        capturedActions.push({ type: 'modify', id, body: requestBody });
        return { data: { id } };
      },
      trash: async ({ id }: { id: string }) => {
        capturedActions.push({ type: 'trash', id });
        return { data: { id } };
      },
      untrash: async ({ id }: { id: string }) => {
        capturedActions.push({ type: 'untrash', id });
        return { data: { id } };
      },
      send: async ({ requestBody }: { requestBody: { raw: string; threadId?: string } }) => {
        capturedSends.push({ raw: requestBody.raw, threadId: requestBody.threadId });
        return { data: { id: 'message-sent-new', threadId: requestBody.threadId ?? 'thread-new' } };
      },
    },
    threads: {
      get: async ({ id }: { id: string }) => ({
        data: {
          messages: id === 'thread-client'
            ? [
                fullMessage(messages.inbox, 'Necesito información para la campaña.'),
                fullMessage(messages.sent, 'Te enviaré la propuesta mañana.'),
              ]
            : id === 'thread-briefing'
              ? [fullMessage(messages.briefing, 'Quedo pendiente del briefing para preparar la propuesta.')]
              : [fullMessage(messages.incremental, 'Nueva información para actualizar la propuesta.')],
        },
      }),
    },
  },
};

const gmailMock = mock.method(google, 'gmail', () => fakeGmail as ReturnType<typeof google.gmail>);

const { getAnalysisDays, getAnalysisWindow, listClientHistory, listDetectedCommitments, listPendingFollowUps, listRecentMailboxContext, listRecentMessages, modifyGmailMessage, sendGmailMessage, syncGmailAccount } = await import('../src/google-oauth.ts?google-mock-test');
const { saveGoogleTokens } = await import('../src/token-store.ts?google-mock-token-store');

await saveGoogleTokens(account, { access_token: 'mock-access-token' });

test.after(async () => {
  gmailMock.mock.restore();
  await rm(dataDirectory, { recursive: true, force: true });
});

test('usa una respuesta simulada de Gmail para cargar mensajes y separar bandejas', async () => {
  const inbox = await listRecentMessages(account, 10, 'inbox');
  const sent = await listRecentMessages(account, 10, 'sent');
  const archived = await listRecentMessages(account, 10, 'archived');

  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].subject, 'Consulta de proyecto');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].subject, 'Briefing de campaña');
  assert.equal(archived.length, 2);
  assert.ok(capturedQueries.some((query) => query.includes('-in:inbox')));
});

test('detecta seguimientos y conserva la categoría de briefing con Gmail simulado', async () => {
  const followUps = await listPendingFollowUps(account, 10);

  assert.equal(followUps.length, 2);
  assert.ok(followUps.some((item) => item.category === 'Briefing pendiente'));
  assert.ok(followUps.every((item) => item.reason.includes('sin respuesta')));
  assert.equal(getAnalysisDays(), 30);
  assert.ok(capturedQueries.some((query) => query.startsWith('after:') && query.includes('before:')));
});

test('permite seleccionar un rango de análisis y lo convierte a consulta Gmail', () => {
  const toDate = new Date(Date.now() - 86_400_000);
  const fromDate = new Date(toDate.getTime() - 10 * 86_400_000);
  const asInputDate = (date: Date) => date.toISOString().slice(0, 10);
  const asGmailDate = (date: Date) => asInputDate(date).replaceAll('-', '/');
  const window = getAnalysisWindow({ from: asInputDate(fromDate), to: asInputDate(toDate) });

  assert.equal(window.from, asGmailDate(fromDate));
  assert.equal(window.to, asGmailDate(toDate));
  assert.equal(window.days, 11);
  assert.equal(window.query, `after:${asGmailDate(new Date(fromDate.getTime() - 86_400_000))} before:${asGmailDate(new Date(toDate.getTime() + 86_400_000))}`);
});

test('conserva el alcance del buzón elegido para el análisis', () => {
  assert.equal(getAnalysisWindow({ scope: 'mailbox' }).scope, 'mailbox');
  assert.equal(getAnalysisWindow({ scope: 'all' }).scope, 'all');
  assert.equal(getAnalysisWindow({ scope: 'spam' }).scope, 'spam');
});

test('consulta archivados o spam con el alcance de análisis solicitado', async () => {
  const allMessages = await listRecentMailboxContext(account, 5, getAnalysisWindow({ scope: 'all' }), false, false);
  const spamMessages = await listRecentMailboxContext(account, 5, getAnalysisWindow({ scope: 'spam' }), false, false);

  assert.ok(allMessages.length > 0);
  assert.ok(spamMessages.length > 0);
  assert.ok(capturedQueries.filter((query) => query.startsWith('after:')).length >= 2);
});

test('comparte el contexto de Gmail entre seguimientos y compromisos concurrentes', async () => {
  const before = capturedQueries.length;
  const window = getAnalysisWindow({ scope: 'spam', days: 29 });
  await Promise.all([
    listPendingFollowUps(account, 10, window, false),
    listDetectedCommitments(account, 10, window, false),
  ]);

  assert.equal(capturedQueries.length - before, 1);
});

test('carga el historial de un cliente sin incluir hilos de otros destinatarios', async () => {
  const history = await listClientHistory(account, client, 10);

  assert.equal(history.length, 3);
  assert.deepEqual(history.map((item) => item.subject), ['Re: Consulta de proyecto', 'Consulta de proyecto', 'Briefing de campaña']);
});

test('sincroniza solo los cambios nuevos usando historyId', async () => {
  await syncGmailAccount(account);

  const inbox = await listRecentMessages(account, 10, 'inbox');
  assert.equal(historyCalls, 1);
  assert.equal(inbox[0].subject, 'Nueva consulta recibida');
});

test('aplica acciones de correo únicamente al mensaje solicitado', async () => {
  await modifyGmailMessage(account, messages.inbox.id, 'markRead');
  await modifyGmailMessage(account, messages.sent.id, 'markUnread');
  await modifyGmailMessage(account, messages.inbox.id, 'archive');
  await modifyGmailMessage(account, messages.inbox.id, 'unarchive');
  await modifyGmailMessage(account, messages.inbox.id, 'trash');
  await modifyGmailMessage(account, messages.inbox.id, 'restore');

  assert.deepEqual(capturedActions.slice(-7), [
    { type: 'modify', id: messages.inbox.id, body: { removeLabelIds: ['UNREAD'] } },
    { type: 'modify', id: messages.sent.id, body: { addLabelIds: ['UNREAD'] } },
    { type: 'modify', id: messages.inbox.id, body: { removeLabelIds: ['INBOX'] } },
    { type: 'modify', id: messages.inbox.id, body: { addLabelIds: ['INBOX'] } },
    { type: 'trash', id: messages.inbox.id },
    { type: 'untrash', id: messages.inbox.id },
    { type: 'modify', id: messages.inbox.id, body: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] } },
  ]);
});

test('envía un correo y conserva el hilo cuando es una respuesta', async () => {
  const result = await sendGmailMessage(account, {
    to: client,
    subject: 'Re: Consulta de proyecto',
    body: 'Te respondo con la información solicitada.',
    threadId: messages.inbox.threadId,
    replyToMessageId: messages.inbox.id,
  });

  assert.equal(result.threadId, messages.inbox.threadId);
  assert.equal(capturedSends.at(-1)?.threadId, messages.inbox.threadId);
  assert.match(Buffer.from(capturedSends.at(-1)!.raw, 'base64url').toString('utf8'), /In-Reply-To:/);
});

test('permite enviar un mensaje con varias líneas', async () => {
  const result = await sendGmailMessage(account, {
    to: client,
    subject: 'Información solicitada',
    body: 'Buenos días,\n\nTe envío la información solicitada.',
  });

  assert.equal(result.messageId, 'message-sent-new');
  assert.match(Buffer.from(capturedSends.at(-1)!.raw, 'base64url').toString('utf8'), /Buenos días,\n\nTe envío/);
});
