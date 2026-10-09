import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { loadGoogleTokens, saveGoogleTokens } from './token-store.js';

const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
const pendingStates = new Set<string>();
const gmailCacheTtlMs = 30_000;

type GmailListMessage = {
  id: string;
  threadId: string | null;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  snippet: string;
};

type GmailThreadMessage = {
  id: string | null;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  internalDate: number | null;
  body: string;
};

type CacheEntry<T> = { expiresAt: number; value: T };
const messageCache = new Map<string, CacheEntry<GmailListMessage[]>>();
const threadCache = new Map<string, CacheEntry<GmailThreadMessage[]>>();
const insightsCache = new Map<string, CacheEntry<AccountInsights>>();

export type AccountClient = {
  email: string;
  messages: number;
  latestDate: string | null;
};

export type AccountInsights = {
  inboxMessages: number;
  sentMessages: number;
  reviewedMessages: number;
  clients: AccountClient[];
  latestDate: string | null;
};

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_REDIRECT_URI.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getGmailClient(email: string) {
  const storedTokens = await loadGoogleTokens(email);
  if (!storedTokens) throw new Error('La cuenta no está conectada.');

  const client = getOAuthClient();
  client.setCredentials(storedTokens);
  return google.gmail({ version: 'v1', auth: client });
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
  const cacheKey = `${email.toLowerCase()}:${mailbox}`;
  const cached = messageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.value.length >= maxResults) {
    return cached.value.slice(0, maxResults);
  }

  const gmail = await getGmailClient(email);
  const messages = await listMessagesForLabel(gmail, mailbox === 'sent' ? 'SENT' : 'INBOX', maxResults);
  messageCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: messages });
  return messages;
}

export async function listAccountInsights(email: string, maxResults = 25): Promise<AccountInsights> {
  const normalizedEmail = email.toLowerCase();
  const cached = insightsCache.get(normalizedEmail);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [inbox, sent] = await Promise.all([
    listRecentMessages(email, maxResults, 'inbox'),
    listRecentMessages(email, maxResults, 'sent'),
  ]);
  const clients = new Map<string, AccountClient>();
  const dates = [...inbox, ...sent].map((message) => message.date).filter(Boolean) as string[];

  const addClient = (value: string, date: string | null) => {
    const addresses = extractEmailAddresses(value);
    addresses.forEach((address) => {
      if (address === normalizedEmail) return;
      const current = clients.get(address) ?? { email: address, messages: 0, latestDate: null };
      current.messages += 1;
      if (date && (!current.latestDate || messageTimestamp({ date }) > messageTimestamp({ date: current.latestDate }))) current.latestDate = date;
      clients.set(address, current);
    });
  };

  inbox.forEach((message) => addClient(message.from, message.date));
  sent.forEach((message) => addClient(message.to, message.date));

  const insights: AccountInsights = {
    inboxMessages: inbox.length,
    sentMessages: sent.length,
    reviewedMessages: inbox.length + sent.length,
    clients: [...clients.values()].sort((left, right) => right.messages - left.messages || left.email.localeCompare(right.email)),
    latestDate: dates.sort((left, right) => messageTimestamp({ date: right }) - messageTimestamp({ date: left }))[0] ?? null,
  };
  insightsCache.set(normalizedEmail, { expiresAt: Date.now() + gmailCacheTtlMs, value: insights });
  return insights;
}

export async function listPendingFollowUps(email: string, maxResults = 10) {
  const gmail = await getGmailClient(email);
  const sentMessages = await listRecentMessages(email, Math.min(Math.max(maxResults * 2, 10), 20), 'sent');
  const threadIds = [...new Set(sentMessages.map((message) => message.threadId).filter(Boolean))] as string[];
  const threads = await Promise.all(threadIds.map((threadId) => getCachedThreadMessages(email, gmail, threadId)));
  const pending = threads.flatMap((thread) => {
    const ordered = [...thread].sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
    const lastMessage = ordered.at(-1);
    if (!lastMessage || !isMessageFromAccount(lastMessage.from, email)) return [];

    const timestamp = messageTimestamp(lastMessage);
    if (!timestamp) return [];

    const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
    return [{
      threadId: lastMessage.threadId,
      client: lastMessage.to || '(Destinatario desconocido)',
      subject: lastMessage.subject,
      date: lastMessage.date,
      ageDays,
      reason: ageDays > 0
        ? `Último mensaje enviado sin respuesta; han pasado ${ageDays} días.`
        : 'Último mensaje enviado sin respuesta; se envió hoy.',
    }];
  });

  return pending
    .sort((left, right) => right.ageDays - left.ageDays || left.subject.localeCompare(right.subject))
    .slice(0, maxResults);
}

export async function listDetectedCommitments(email: string, maxResults = 10) {
  const context = await listRecentMailboxContext(email, 10);
  const seen = new Set<string>();
  const commitments = context.flatMap((candidate) => candidate.threadMessages.flatMap((message) => {
    const owner = isMessageFromAccount(message.from, email) ? 'Tú' : message.from;
    return extractCommitmentSentences(message.body).map((commitment) => {
      const key = `${message.threadId}:${commitment.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        threadId: message.threadId,
        owner,
        subject: message.subject,
        date: message.date,
        commitment,
        status: 'Pendiente de revisión',
        reason: 'Frase de solicitud, confirmación, envío o plazo detectada en el hilo.',
      };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }));

  return commitments
    .sort((left, right) => messageTimestamp(right) - messageTimestamp(left))
    .slice(0, maxResults);
}

export async function listRecentMailboxContext(email: string, maxPerFolder = 5) {
  const gmail = await getGmailClient(email);
  const [inbox, sent] = await Promise.all([
    listRecentMessages(email, maxPerFolder, 'inbox'),
    listRecentMessages(email, maxPerFolder, 'sent'),
  ]);

  const candidates = [
    ...inbox.map((message) => ({ ...message, mailbox: 'recibidos' })),
    ...sent.map((message) => ({ ...message, mailbox: 'enviados' })),
  ];

  const threadIds = [...new Set(candidates.map((message) => message.threadId).filter(Boolean))] as string[];
  const threadEntries = await Promise.all(
    threadIds.map(async (threadId) => [threadId, await getCachedThreadMessages(email, gmail, threadId)] as const),
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
  const gmail = await getGmailClient(email);
  return getCachedThreadMessages(email, gmail, threadId);
}

async function getCachedThreadMessages(email: string, gmail: ReturnType<typeof google.gmail>, threadId: string) {
  const cacheKey = `${email.toLowerCase()}:${threadId}`;
  const cached = threadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const messages = await getThreadMessagesFromGmail(gmail, threadId);
  threadCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: messages });
  return messages;
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
      internalDate: message.internalDate ? Number(message.internalDate) : null,
      body: cleanEmailBody(extractText(message.payload)),
    };
  });
}

function isMessageFromAccount(from: string, email: string) {
  const normalizedEmail = email.toLowerCase();
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? from;
  return address.trim().toLowerCase() === normalizedEmail;
}

function messageTimestamp(message: { internalDate?: number | null; date?: string | null }) {
  if (message.internalDate && Number.isFinite(message.internalDate)) return message.internalDate;
  if (!message.date) return 0;
  const timestamp = Date.parse(message.date);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function extractCommitmentSentences(body: string) {
  const commitmentPattern = /\b(?:te\s+enviar(?:é|e|emos)|enviar(?:é|e|emos)|quedo\s+a\s+la\s+espera|confirm(?:ar|ación|ame|es)|necesit(?:o|amos)\s+que|puedes\s+confirmar|avis(?:a|ar|en)|borr(?:ar|e|emos)|revoc(?:ar|ación)|rotar|termin(?:en|ar)|please\s+confirm|will\s+send|waiting\s+for|let\s+me\s+know|need\s+you\s+to|deadline)\b/i;
  return body
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 320 && commitmentPattern.test(sentence))
    .map((sentence) => sentence.slice(0, 280));
}

type GmailPayload = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: unknown[] | null;
};

function extractText(payload: GmailPayload | null | undefined): string {
  if (!payload) return '';

  const parts = (payload.parts ?? []) as GmailPayload[];
  const plainParts = parts.filter((part) => part.mimeType === 'text/plain');
  const nestedPlainText = plainParts.map(readPayloadData).filter(Boolean).join('\n\n');
  if (nestedPlainText) return cleanPlainText(nestedPlainText);

  if (payload.mimeType === 'text/plain') return cleanPlainText(readPayloadData(payload));

  const nestedText = parts.map(extractText).filter(Boolean).join('\n\n');
  if (nestedText) return nestedText;

  if (payload.mimeType === 'text/html') return htmlToPlainText(readPayloadData(payload));
  return cleanPlainText(readPayloadData(payload));
}

function readPayloadData(payload: GmailPayload): string {
  return payload.body?.data ? Buffer.from(payload.body.data, 'base64url').toString('utf8') : '';
}

function cleanPlainText(value: string): string {
  const decoded = decodeHtmlEntities(value).replace(/\r\n?/g, '\n').trim();
  return /<\s*(?:!doctype|html|head|body|table|style|script|div|p|br)\b/i.test(decoded)
    ? htmlToPlainText(decoded)
    : decoded;
}

function cleanEmailBody(value: string): string {
  const lines = redactSensitiveValues(value)
    .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200d\u2060\ufeff]/g, '')
    .split('\n')
    .filter((line) => !/^\s*[([\s]*https?:\/\/\S+[)\]]?\s*$/i.test(line))
    .map((line) => line.replace(/https?:\/\/\S+/gi, '').replace(/\s+$/g, '').trim())
    .filter((line, index, all) => line || all[index - 1] !== '')
    .join('\n')
    .replace(/\(\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const maxVisibleCharacters = 8000;
  return lines.length > maxVisibleCharacters
    ? `${lines.slice(0, maxVisibleCharacters).trim()}\n\n[…contenido del correo recortado…]`
    : lines;
}

function redactSensitiveValues(value: string): string {
  return value
    .replace(/((?:api\s*(?:key|token)|access\s+token|refresh\s+token|password|contraseña|clave(?:\s+api)?)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTADO]')
    .replace(/\b(?:cb1|sk|pk)_[A-Za-z0-9_-]{12,}\b/gi, '[REDACTADO]');
}

function htmlToPlainText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<\/?(?:script|style|noscript|template|head)[^>]*>[\s\S]*?<\/?(?:script|style|noscript|template|head)\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ',
    auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Euml: 'Ë', Iuml: 'Ï', Ouml: 'Ö', Uuml: 'Ü',
    agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù', Agrave: 'À', Egrave: 'È', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
    nbsp: ' ', zwnj: '', zwj: '', shy: '', euro: '€', hellip: '…', ndash: '–', mdash: '—',
    laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', reg: '®', trade: '™',
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const numericCode = code.slice(1);
      const number = numericCode.toLowerCase().startsWith('x')
        ? Number.parseInt(numericCode.slice(1), 16)
        : Number.parseInt(numericCode, 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : '';
    }
    return namedEntities[code.toLowerCase()] ?? match;
  });
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
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      });
      const headers = Object.fromEntries(
        (data.payload?.headers ?? []).map((header) => [header.name ?? '', header.value ?? '']),
      );

      return {
        id,
        threadId: data.threadId ?? null,
        subject: headers.Subject || '(Sin asunto)',
        from: headers.From || '(Remitente desconocido)',
        to: headers.To || '',
        date: headers.Date || null,
        snippet: cleanEmailBody(data.snippet ?? ''),
      };
    }),
  );

  return messages.filter((message): message is NonNullable<typeof message> => message !== null);
}

function extractEmailAddresses(value: string) {
  const matches = [...value.matchAll(/<([^>]+)>|([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi)]
    .map((match) => (match[1] ?? match[2]).trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(matches)];
}
