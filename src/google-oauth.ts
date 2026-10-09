import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { loadGoogleTokens, saveGoogleTokens } from './token-store.js';

const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
const pendingStates = new Set<string>();

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_REDIRECT_URI.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function createAuthorizationUrl() {
  const state = randomUUID();
  pendingStates.add(state);

  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    scope: [gmailScope],
    state,
  });

  return url;
}

export async function completeAuthorization(code: string, state: string) {
  if (!pendingStates.delete(state)) {
    throw new Error('Estado OAuth inválido o caducado.');
  }

  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: client });
  const { data } = await gmail.users.getProfile({ userId: 'me' });

  if (data.emailAddress) {
    await saveGoogleTokens(data.emailAddress, tokens as unknown as Record<string, unknown>);
  }

  return {
    emailAddress: data.emailAddress ?? null,
    messagesTotal: data.messagesTotal ?? 0,
    threadsTotal: data.threadsTotal ?? 0,
    note: 'Cuenta conectada. Los tokens se han guardado cifrados localmente.',
  };
}

export async function listRecentMessages(email: string, maxResults = 10, mailbox: 'inbox' | 'sent' = 'inbox') {
  const storedTokens = await loadGoogleTokens(email);
  if (!storedTokens) throw new Error('La cuenta no está conectada.');

  const client = getOAuthClient();
  client.setCredentials(storedTokens);
  const gmail = google.gmail({ version: 'v1', auth: client });
  return listMessagesForLabel(gmail, mailbox === 'sent' ? 'SENT' : 'INBOX', maxResults);
}

export async function listRecentMailboxContext(email: string, maxPerFolder = 5) {
  const storedTokens = await loadGoogleTokens(email);
  if (!storedTokens) throw new Error('La cuenta no está conectada.');

  const client = getOAuthClient();
  client.setCredentials(storedTokens);
  const gmail = google.gmail({ version: 'v1', auth: client });
  const [inbox, sent] = await Promise.all([
    listMessagesForLabel(gmail, 'INBOX', maxPerFolder),
    listMessagesForLabel(gmail, 'SENT', maxPerFolder),
  ]);

  const candidates = [
    ...inbox.map((message) => ({ ...message, mailbox: 'recibidos' })),
    ...sent.map((message) => ({ ...message, mailbox: 'enviados' })),
  ];

  const threadIds = [...new Set(candidates.map((message) => message.threadId).filter(Boolean))] as string[];
  const threadEntries = await Promise.all(
    threadIds.map(async (threadId) => [threadId, await getThreadMessagesFromGmail(gmail, threadId)] as const),
  );
  const threadsById = new Map(threadEntries);

  return candidates.map((message) => ({
    ...message,
    threadMessages: (threadsById.get(message.threadId ?? '') ?? []).map((threadMessage) => ({
      ...threadMessage,
      body: threadMessage.body.slice(0, 8000),
    })),
  }));
}

export async function getThreadMessages(email: string, threadId: string) {
  const storedTokens = await loadGoogleTokens(email);
  if (!storedTokens) throw new Error('La cuenta no está conectada.');

  const client = getOAuthClient();
  client.setCredentials(storedTokens);
  const gmail = google.gmail({ version: 'v1', auth: client });
  return getThreadMessagesFromGmail(gmail, threadId);
}

async function getThreadMessagesFromGmail(gmail: ReturnType<typeof google.gmail>, threadId: string) {
  const { data } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  return (data.messages ?? []).map((message) => {
    const headers = Object.fromEntries(
      (message.payload?.headers ?? []).map((header) => [header.name ?? '', header.value ?? '']),
    );

    return {
      id: message.id ?? null,
      threadId: message.threadId ?? threadId,
      subject: headers.Subject || '(Sin asunto)',
      from: headers.From || '(Remitente desconocido)',
      to: headers.To || '',
      date: headers.Date || null,
      body: extractText(message.payload),
    };
  });
}

function extractText(payload: { mimeType?: string | null; body?: { data?: string | null } | null; parts?: unknown[] | null } | null | undefined): string {
  if (!payload) return '';
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');

  const parts = (payload.parts ?? []) as Array<Parameters<typeof extractText>[0]>;
  const texts = parts.map((part) => extractText(part)).filter(Boolean);
  return texts.join('\n\n');
}

async function listMessagesForLabel(gmail: ReturnType<typeof google.gmail>, label: 'INBOX' | 'SENT', maxResults: number) {
  const listed = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [label],
    maxResults: Math.min(Math.max(maxResults, 1), 50),
  });

  const messages = await Promise.all(
    (listed.data.messages ?? []).map(async ({ id }) => {
      if (!id) return null;
      const { data } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });
      const headers = Object.fromEntries(
        (data.payload?.headers ?? []).map((header) => [header.name ?? '', header.value ?? '']),
      );

      return {
        id,
        threadId: data.threadId ?? null,
        subject: headers.Subject || '(Sin asunto)',
        from: headers.From || '(Remitente desconocido)',
        date: headers.Date || null,
        snippet: data.snippet ?? '',
      };
    }),
  );

  return messages.filter((message): message is NonNullable<typeof message> => message !== null);
}
