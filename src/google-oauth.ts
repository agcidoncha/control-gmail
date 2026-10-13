import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { loadGoogleTokens, saveGoogleTokens } from './token-store.js';
import {
  findStoredGmailMessages,
  getGmailSyncState,
  getStoredGmailThread,
  listStoredGmailMessages,
  saveGmailSyncSnapshot,
  type StoredGmailMessage,
  type StoredMailbox,
  type StoredThreadMessage,
} from './gmail-store.js';
import { listGmailActions } from './gmail-action-store.js';

const gmailModifyScope = 'https://www.googleapis.com/auth/gmail.modify';
const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';
const pendingStates = new Set<string>();
const gmailCacheTtlMs = 30_000;
const defaultAnalysisDays = 30;
const maxAnalysisDays = 3650;

export type GmailListMessage = {
  id: string;
  threadId: string | null;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  snippet: string;
  labelIds: string[];
  important: boolean;
  bounced: boolean;
};

export type GmailMailbox = 'inbox' | 'sent' | 'archived' | 'appArchived' | 'spam';

export type GmailMessageAction = 'markRead' | 'markUnread' | 'archive' | 'unarchive' | 'trash';

export type GmailSendInput = {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  replyToMessageId?: string;
};

export type GmailThreadMessage = {
  id: string | null;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string | null;
  internalDate: number | null;
  body: string;
  dateHints: string[];
};

type PendingFollowUp = {
  threadId: string;
  client: string;
  subject: string;
  date: string | null;
  ageDays: number;
  category: string;
  reason: string;
};

type DetectedCommitment = {
  threadId: string;
  owner: string;
  subject: string;
  date: string | null;
  commitment: string;
  status: string;
  reason: string;
};

type AnalysisMailboxContextMessage = GmailListMessage & {
  mailbox: string;
  threadMessages: GmailThreadMessage[];
};

type CacheEntry<T> = { expiresAt: number; value: T };
const messageCache = new Map<string, CacheEntry<GmailListMessage[]>>();
const threadCache = new Map<string, CacheEntry<GmailThreadMessage[]>>();
const insightsCache = new Map<string, CacheEntry<AccountInsights>>();
const followUpCache = new Map<string, CacheEntry<PendingFollowUp[]>>();
const commitmentCache = new Map<string, CacheEntry<DetectedCommitment[]>>();
const mailboxContextCache = new Map<string, CacheEntry<AnalysisMailboxContextMessage[]>>();
const nextPageTokenCache = new Map<string, string | null>();
const messageRequests = new Map<string, Promise<GmailListMessage[]>>();
const threadRequests = new Map<string, Promise<GmailThreadMessage[]>>();
const followUpRequests = new Map<string, Promise<PendingFollowUp[]>>();
const commitmentRequests = new Map<string, Promise<DetectedCommitment[]>>();
const mailboxContextRequests = new Map<string, Promise<AnalysisMailboxContextMessage[]>>();
const syncRequests = new Map<string, Promise<void>>();

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

export type AnalysisWindow = {
  from: string;
  to: string;
  days: number;
  query: string;
  scope: AnalysisScope;
};

export type AnalysisScope = 'mailbox' | 'all' | 'spam';

type AnalysisWindowInput = {
  days?: number;
  from?: string;
  to?: string;
  scope?: AnalysisScope;
};

export function getAnalysisDays() {
  const configured = Number.parseInt(process.env.AI_ANALYSIS_DAYS ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, maxAnalysisDays) : defaultAnalysisDays;
}

export function getAnalysisMessageLimit() {
  const configured = Number.parseInt(process.env.AI_MAX_MESSAGES ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 1000) : 30;
}

function formatGmailDate(date: Date) {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} debe tener el formato AAAA-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatGmailDate(date).replaceAll('/', '-') !== value) {
    throw new Error(`${field} no es una fecha válida.`);
  }
  return date;
}

export function getAnalysisWindow(input: AnalysisWindowInput = {}): AnalysisWindow {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = input.to ? parseDateInput(input.to, 'La fecha final') : today;
  if (to > today) throw new Error('La fecha final no puede estar en el futuro.');
  const requestedDays = Number.isFinite(input.days) && Number(input.days) > 0
    ? Math.min(Number(input.days), maxAnalysisDays)
    : getAnalysisDays();
  const from = input.from
    ? parseDateInput(input.from, 'La fecha inicial')
    : new Date(to.getTime() - (requestedDays - 1) * 86_400_000);

  if (from > to) throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > maxAnalysisDays) throw new Error(`El rango máximo de análisis es de ${maxAnalysisDays} días.`);

  const exclusiveTo = new Date(to.getTime() + 86_400_000);
  return {
    from: formatGmailDate(from),
    to: formatGmailDate(to),
    days,
    query: `after:${formatGmailDate(new Date(from.getTime() - 86_400_000))} before:${formatGmailDate(exclusiveTo)}`,
    scope: input.scope === 'all' || input.scope === 'spam' ? input.scope : 'mailbox',
  };
}

function messageCacheKey(email: string, mailbox: string, query = '') {
  return `${email.toLowerCase()}:${mailbox}:${query}`;
}

function clearAccountCaches(email: string) {
  const prefix = `${email.toLowerCase()}:`;
  [messageCache, threadCache, insightsCache, followUpCache, commitmentCache, mailboxContextCache, nextPageTokenCache]
    .forEach((cache) => [...cache.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => cache.delete(key)));
}

function analysisCacheKey(email: string, analysisWindow: AnalysisWindow) {
  return `${email.toLowerCase()}:${analysisWindow.scope}:${analysisWindow.query}`;
}

function mailboxContextCacheKey(email: string, maxPerFolder: number, analysisWindow: AnalysisWindow, includeBodies: boolean, ensureSnapshot: boolean) {
  const limit = Math.max(maxPerFolder, getAnalysisMessageLimit());
  return `${analysisCacheKey(email, analysisWindow)}:context:${limit}:${includeBodies ? 'bodies' : 'snippets'}:${ensureSnapshot ? 'sync' : 'stored'}`;
}

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

function getSyncMessageLimit() {
  const configured = Number.parseInt(process.env.GMAIL_SYNC_MAX_MESSAGES ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 1000) : 100;
}

function getSyncIntervalMs() {
  const configured = Number.parseInt(process.env.GMAIL_SYNC_INTERVAL_SECONDS ?? '', 10);
  const seconds = Number.isFinite(configured) && configured > 0 ? configured : 900;
  return seconds * 1000;
}

async function ensureGmailSnapshot(email: string, force = false, requestedWindow = getAnalysisWindow()) {
  const normalizedEmail = email.toLowerCase();
  const state = await getGmailSyncState(normalizedEmail);
  const lastSyncedAt = state ? Date.parse(state.lastSyncedAt) : 0;
  const coversWindow = state ? syncStateCoversWindow(state, requestedWindow) : false;
  if (!force && state && coversWindow && Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < getSyncIntervalMs()) return;

  const existingRequest = syncRequests.get(normalizedEmail);
  if (existingRequest) return existingRequest;

  const request = syncGmailAccount(normalizedEmail, requestedWindow);
  syncRequests.set(normalizedEmail, request);
  try {
    await request;
  } finally {
    syncRequests.delete(normalizedEmail);
  }
}

export async function syncGmailAccount(email: string, analysisWindow = getAnalysisWindow()) {
  const normalizedEmail = email.toLowerCase();
  const existingState = await getGmailSyncState(normalizedEmail);
  if (existingState?.historyId && syncStateCoversWindow(existingState, analysisWindow)) {
    try {
      await syncGmailChanges(normalizedEmail, existingState, analysisWindow);
      return;
    } catch (error) {
      if (!isExpiredHistoryError(error)) throw error;
    }
  }

  const gmail = await getGmailClient(normalizedEmail);
  const limit = getSyncMessageLimit();
  // Primero sincronizamos el índice. El cuerpo completo de los hilos se
  // obtiene de forma diferida al abrir cada módulo o un hilo concreto.
  const inbox = await listAnalysisMessagesWithClient(gmail, 'INBOX', analysisWindow, limit);
  const sent = await listAnalysisMessagesWithClient(gmail, 'SENT', analysisWindow, limit);
  const messages = [
    ...inbox.map((message) => toStoredMessage(normalizedEmail, 'inbox', message)),
    ...sent.map((message) => toStoredMessage(normalizedEmail, 'sent', message)),
  ];
  const threads: StoredThreadMessage[][] = [];
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });

  await saveGmailSyncSnapshot({
    email: normalizedEmail,
    messages,
    threads,
    syncState: {
      accountEmail: normalizedEmail,
      from: analysisWindow.from,
      to: analysisWindow.to,
      lastSyncedAt: new Date().toISOString(),
      messageCount: messages.length,
      threadCount: threads.length,
      truncated: inbox.length >= limit || sent.length >= limit,
      historyId: profile.historyId ?? undefined,
    },
  });
}

export async function refreshGmailAccount(email: string) {
  await ensureGmailSnapshot(email, true);
  clearAccountCaches(email);
  const state = await getGmailSyncState(email);
  return { syncedAt: state?.lastSyncedAt ?? new Date().toISOString() };
}

function syncStateCoversWindow(state: { from: string; to: string }, requestedWindow: AnalysisWindow) {
  const stateFrom = Date.parse(`${state.from.replaceAll('/', '-')}T00:00:00.000Z`);
  const stateTo = Date.parse(`${state.to.replaceAll('/', '-')}T23:59:59.999Z`);
  const requestedFrom = Date.parse(`${requestedWindow.from.replaceAll('/', '-')}T00:00:00.000Z`);
  const requestedTo = Date.parse(`${requestedWindow.to.replaceAll('/', '-')}T23:59:59.999Z`);
  return stateFrom <= requestedFrom && stateTo >= requestedTo;
}

async function syncGmailChanges(email: string, state: NonNullable<Awaited<ReturnType<typeof getGmailSyncState>>>, analysisWindow: AnalysisWindow) {
  const gmail = await getGmailClient(email);
  const history = await listGmailHistory(gmail, state.historyId!);
  const changedIds = [...new Set([
    ...history.messageAdded,
    ...history.labelChanged,
    ...history.messageDeleted,
  ])];
  const removedMessageIds = new Set(history.messageDeleted);
  const changedMessages = await mapWithConcurrency(changedIds.filter((id) => !removedMessageIds.has(id)), 8, async (id) => {
    try {
      return await getGmailMessageMetadata(gmail, id);
    } catch (error) {
      if (isMessageNotFoundError(error)) return null;
      throw error;
    }
  });
  const messages: StoredGmailMessage[] = [];
  const storedThreadIds = new Set<string>();
  const threadIds: string[] = [];
  changedMessages.forEach((message) => {
    if (!message) {
      return;
    }
    const timestamp = messageTimestamp(message);
    const inWindow = timestamp >= Date.parse(`${analysisWindow.from.replaceAll('/', '-')}T00:00:00.000Z`)
      && timestamp <= Date.parse(`${analysisWindow.to.replaceAll('/', '-')}T23:59:59.999Z`);
    const mailbox = message.labelIds.includes('INBOX') ? 'inbox' : message.labelIds.includes('SENT') ? 'sent' : null;
    if (!mailbox || !inWindow) {
      removedMessageIds.add(message.id);
      return;
    }
    messages.push(toStoredMessage(email, mailbox, message));
    if (message.threadId && !storedThreadIds.has(message.threadId)) {
      storedThreadIds.add(message.threadId);
      threadIds.push(message.threadId);
    }
  });
  const threads = await mapWithConcurrency(threadIds, 8, (threadId) => getThreadMessagesFromGmail(gmail, threadId));
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });
  await saveGmailSyncSnapshot({
    email,
    messages,
    threads,
    removedMessageIds: [...removedMessageIds],
    syncState: {
      ...state,
      from: analysisWindow.from,
      to: analysisWindow.to,
      lastSyncedAt: new Date().toISOString(),
      historyId: profile.historyId ?? history.historyId ?? state.historyId,
    },
  });
}

async function listGmailHistory(gmail: ReturnType<typeof google.gmail>, startHistoryId: string) {
  const messageAdded: string[] = [];
  const labelChanged: string[] = [];
  const messageDeleted: string[] = [];
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  do {
    const response = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      pageToken,
      historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved', 'messageDeleted'],
    });
    historyId = response.data.historyId ?? historyId;
    for (const item of response.data.history ?? []) {
      messageAdded.push(...(item.messagesAdded ?? []).map((entry) => entry.message?.id).filter((id): id is string => Boolean(id)));
      labelChanged.push(...(item.labelsAdded ?? []).map((entry) => entry.message?.id).filter((id): id is string => Boolean(id)));
      labelChanged.push(...(item.labelsRemoved ?? []).map((entry) => entry.message?.id).filter((id): id is string => Boolean(id)));
      messageDeleted.push(...(item.messagesDeleted ?? []).map((entry) => entry.message?.id).filter((id): id is string => Boolean(id)));
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return { historyId, messageAdded, labelChanged, messageDeleted };
}

async function getGmailMessageMetadata(gmail: ReturnType<typeof google.gmail>, id: string): Promise<GmailListMessage> {
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
    labelIds: data.labelIds ?? [],
    important: (data.labelIds ?? []).includes('IMPORTANT'),
    bounced: (data.labelIds ?? []).includes('INBOX') && looksLikeBounce(headers.Subject || '', data.snippet ?? ''),
  };
}

function isExpiredHistoryError(error: unknown) {
  const candidate = error as { code?: number; response?: { status?: number }; message?: string };
  return candidate.code === 404 || candidate.response?.status === 404 || /historyId|startHistoryId|not found/i.test(candidate.message ?? '');
}

function isMessageNotFoundError(error: unknown) {
  const candidate = error as { code?: number; response?: { status?: number }; message?: string };
  return candidate.code === 404 || candidate.response?.status === 404 || /message.*not found/i.test(candidate.message ?? '');
}

function toStoredMessage(email: string, mailbox: StoredMailbox, message: GmailListMessage): StoredGmailMessage {
  return {
    ...message,
    accountEmail: email,
    mailbox,
    sortTimestamp: messageTimestamp(message),
    syncedAt: new Date().toISOString(),
  };
}

function fromStoredMessage(message: StoredGmailMessage): GmailListMessage {
  return {
    id: message.id,
    threadId: message.threadId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    snippet: message.snippet,
    labelIds: message.labelIds,
    important: message.important,
    bounced: message.bounced,
  };
}

function encodePageOffset(offset: number) {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodePageOffset(value?: string) {
  if (!value) return 0;
  const offset = Number.parseInt(Buffer.from(value, 'base64url').toString('utf8'), 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

export function createAuthorizationUrl() {
  const state = randomUUID();
  pendingStates.add(state);

  const client = getOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    // La reautorización conserva la lectura y habilita las acciones de correo.
    // Cada usuario debe aceptar de nuevo estos permisos antes de operar.
    scope: [gmailModifyScope, gmailSendScope],
    state,
  });

  return url;
}

export async function modifyGmailMessage(email: string, messageId: string, action: GmailMessageAction) {
  if (!messageId || !/^[\w-]+$/.test(messageId)) throw new Error('Identificador de mensaje no válido.');

  const gmail = await getGmailClient(email);
  if (action === 'trash') {
    await gmail.users.messages.trash({ userId: 'me', id: messageId });
  } else if (action === 'markRead') {
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { removeLabelIds: ['UNREAD'] } });
  } else if (action === 'markUnread') {
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds: ['UNREAD'] } });
  } else if (action === 'archive') {
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { removeLabelIds: ['INBOX'] } });
  } else if (action === 'unarchive') {
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds: ['INBOX'] } });
  } else {
    throw new Error('Acción de correo no válida.');
  }

  // Evita servir una copia antigua en la misma sesión. La sincronización de
  // Gmail actualizará el snapshot persistido antes de la siguiente carga.
  clearAccountCaches(email);
  return { action, messageId };
}

export async function sendGmailMessage(email: string, input: GmailSendInput) {
  const to = input.to.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('Introduce un destinatario válido.');
  if (!subject || subject.length > 500) throw new Error('El asunto es obligatorio y no puede superar 500 caracteres.');
  if (!body || body.length > 100_000) throw new Error('El mensaje es obligatorio y no puede superar 100.000 caracteres.');
  if ([to, subject, input.threadId, input.replyToMessageId].some((value) => value?.includes('\r') || value?.includes('\n'))) {
    throw new Error('El mensaje contiene saltos de línea no válidos en un encabezado.');
  }

  const gmail = await getGmailClient(email);
  const headers = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit'];
  if (input.replyToMessageId) {
    const { data } = await gmail.users.messages.get({
      userId: 'me',
      id: input.replyToMessageId,
      format: 'metadata',
      metadataHeaders: ['Message-ID', 'References'],
    });
    const parentHeaders = Object.fromEntries((data.payload?.headers ?? []).map((header) => [header.name?.toLowerCase() ?? '', header.value ?? '']));
    if (parentHeaders['message-id']) headers.push(`In-Reply-To: ${parentHeaders['message-id']}`);
    const references = [parentHeaders.references, parentHeaders['message-id']].filter(Boolean).join(' ');
    if (references) headers.push(`References: ${references}`);
  }

  const raw = `${headers.join('\r\n')}\r\n\r\n${body}`;
  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: Buffer.from(raw, 'utf8').toString('base64url'),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  });
  clearAccountCaches(email);
  return { messageId: data.id ?? null, threadId: data.threadId ?? input.threadId ?? null };
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

const archivedMailboxQuery = '-in:inbox -in:sent -in:spam -in:trash -in:drafts';

export async function listRecentMessages(email: string, maxResults = 10, mailbox: GmailMailbox = 'inbox', query = '', organizationId = process.env.DEFAULT_ORGANIZATION_ID ?? 'org_publicidad_segmentada_tv') {
  if (mailbox === 'appArchived') {
    const messages = await listAppArchivedMessages(email, organizationId, maxResults);
    return messages.messages.filter((message) => !query || `${message.subject} ${message.from} ${message.to} ${message.snippet}`.toLowerCase().includes(query.toLowerCase()));
  }
  if (mailbox === 'archived' || mailbox === 'spam') {
    const cacheKey = messageCacheKey(email, mailbox, query);
    const cached = messageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.value.length >= maxResults) {
      return cached.value.slice(0, maxResults);
    }

    const existingRequest = messageRequests.get(cacheKey);
    if (existingRequest) return (await existingRequest).slice(0, maxResults);

    const request = (async () => {
      const gmail = await getGmailClient(email);
      const label = mailbox === 'spam' ? 'SPAM' : undefined;
      const mailboxQuery = [mailbox === 'archived' ? archivedMailboxQuery : '', query].filter(Boolean).join(' ');
      const page = await listMessagesForLabel(gmail, label, maxResults, undefined, mailboxQuery);
      nextPageTokenCache.set(cacheKey, page.nextPageToken);
      return page.messages;
    })();
    messageRequests.set(cacheKey, request);

    try {
      const messages = await request;
      messageCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: messages });
      return messages.slice(0, maxResults);
    } finally {
      messageRequests.delete(cacheKey);
    }
  }

  await ensureGmailSnapshot(email);
  const stored = await listStoredGmailMessages(email, mailbox, maxResults);
  return stored.messages.map(fromStoredMessage).filter((message) => !query || `${message.subject} ${message.from} ${message.to} ${message.snippet}`.toLowerCase().includes(query.toLowerCase()));
}

export async function listRecentMessagesPage(
  email: string,
  maxResults = 10,
  mailbox: GmailMailbox = 'inbox',
  pageToken?: string,
  organizationId = process.env.DEFAULT_ORGANIZATION_ID ?? 'org_publicidad_segmentada_tv',
  forceRefresh = false,
) {
  if (mailbox === 'appArchived') {
    const offset = decodePageOffset(pageToken);
    const page = await listAppArchivedMessages(email, organizationId, maxResults, offset);
    return {
      messages: page.messages,
      nextPageToken: page.nextOffset === null ? null : encodePageOffset(page.nextOffset),
    };
  }
  if (mailbox === 'archived' || mailbox === 'spam') {
    const cacheKey = messageCacheKey(email, mailbox);
    if (!pageToken) {
      const messages = await listRecentMessages(email, maxResults, mailbox);
      return {
        messages,
        nextPageToken: nextPageTokenCache.get(cacheKey) ?? null,
      };
    }

    const gmail = await getGmailClient(email);
    const label = mailbox === 'spam' ? 'SPAM' : undefined;
    return listMessagesForLabel(gmail, label, maxResults, pageToken, mailbox === 'archived' ? archivedMailboxQuery : '');
  }

  await ensureGmailSnapshot(email, forceRefresh);
  const page = await listStoredGmailMessages(email, mailbox, maxResults, decodePageOffset(pageToken));
  return {
    messages: page.messages.map(fromStoredMessage),
    nextPageToken: page.nextOffset === null ? null : encodePageOffset(page.nextOffset),
  };
}

async function listAppArchivedMessages(email: string, organizationId: string, maxResults: number, offset = 0) {
  const actions = await listGmailActions({
    organizationId,
    userEmail: email,
    accountEmail: email,
    action: undefined,
    outcome: 'success',
    limit: 1000,
  });
  const latestByMessage = new Map<string, (typeof actions)[number]>();
  actions.forEach((action) => {
    if (!latestByMessage.has(action.messageId)) latestByMessage.set(action.messageId, action);
  });
  const messageIds = [...latestByMessage.values()]
    .filter((action) => action.action === 'archive')
    .map((action) => action.messageId);
  if (!messageIds.length) return { messages: [] as GmailListMessage[], nextOffset: null as number | null };

  const gmail = await getGmailClient(email);
  const currentMessages = await mapWithConcurrency(messageIds, 8, async (messageId) => {
    try {
      return await getGmailMessageMetadata(gmail, messageId);
    } catch (error) {
      if (isMessageNotFoundError(error)) return null;
      throw error;
    }
  });
  const archived = currentMessages.filter((message): message is GmailListMessage => {
    if (!message) return false;
    return !message.labelIds.includes('INBOX')
      && !message.labelIds.includes('TRASH')
      && !message.labelIds.includes('SPAM');
  });
  const size = Math.min(Math.max(maxResults, 1), 50);
  const messages = archived.slice(Math.max(offset, 0), Math.max(offset, 0) + size);
  return {
    messages,
    nextOffset: offset + messages.length < archived.length ? offset + messages.length : null,
  };
}

async function listAnalysisMessages(email: string, mailbox: 'inbox' | 'sent', analysisWindow: AnalysisWindow, maxMessages = getAnalysisMessageLimit(), ensureSnapshot = true) {
  if (ensureSnapshot) await ensureGmailSnapshot(email, false, analysisWindow);
  const stored = await listStoredGmailMessages(email, mailbox, maxMessages);
  const fromTimestamp = Date.parse(`${analysisWindow.from.replaceAll('/', '-')}T00:00:00.000Z`);
  const toTimestamp = Date.parse(`${analysisWindow.to.replaceAll('/', '-')}T23:59:59.999Z`);
  return stored.messages
    .filter((message) => message.sortTimestamp >= fromTimestamp && message.sortTimestamp <= toTimestamp)
    .map(fromStoredMessage);
}

async function listAnalysisMessagesForScope(email: string, analysisWindow: AnalysisWindow, maxMessages = getAnalysisMessageLimit()) {
  const gmail = await getGmailClient(email);
  const label = analysisWindow.scope === 'spam' ? 'SPAM' : undefined;
  return listAnalysisMessagesWithClient(gmail, label, analysisWindow, maxMessages);
}

async function listAnalysisMessagesWithClient(
  gmail: ReturnType<typeof google.gmail>,
  label: 'INBOX' | 'SENT' | 'SPAM' | undefined,
  analysisWindow: AnalysisWindow,
  maxMessages: number,
) {
  const messages: GmailListMessage[] = [];
  let pageToken: string | undefined;
  const limit = Math.min(Math.max(maxMessages, 1), 1000);

  do {
    const page = await listMessagesForLabel(gmail, label, Math.min(50, limit - messages.length), pageToken, analysisWindow.query);
    messages.push(...page.messages);
    pageToken = page.nextPageToken ?? undefined;
    if (messages.length >= limit || !pageToken) break;
  } while (pageToken);

  return messages.slice(0, limit);
}

export async function listAccountInsights(email: string, maxResults = 25, analysisWindow = getAnalysisWindow()): Promise<AccountInsights> {
  const normalizedEmail = email.toLowerCase();
  const cacheKey = analysisCacheKey(email, analysisWindow);
  const cached = insightsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [inbox, sent] = await Promise.all([
    listAnalysisMessages(email, 'inbox', analysisWindow, Math.max(maxResults, getAnalysisMessageLimit())),
    listAnalysisMessages(email, 'sent', analysisWindow, Math.max(maxResults, getAnalysisMessageLimit())),
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
  insightsCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: insights });
  return insights;
}

export async function listPendingFollowUps(email: string, maxResults = 10, analysisWindow = getAnalysisWindow(), ensureSnapshot = true) {
  const cacheKey = analysisCacheKey(email, analysisWindow);
  const cached = followUpCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value.slice(0, maxResults);

  const existingRequest = followUpRequests.get(cacheKey);
  if (existingRequest) return (await existingRequest).slice(0, maxResults);

  const request = (async (): Promise<PendingFollowUp[]> => {
    const context = await listRecentMailboxContext(email, 10, analysisWindow, false, ensureSnapshot);
    const threads = new Map<string, GmailThreadMessage[]>();
    context.forEach((candidate) => {
      if (!candidate.threadId) return;
      const current = threads.get(candidate.threadId) ?? candidate.threadMessages;
      threads.set(candidate.threadId, current);
    });
    const pending = [...threads.values()].flatMap((thread) => {
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
        category: classifyFollowUp(ordered),
        reason: ageDays > 0
          ? `Último mensaje enviado sin respuesta; han pasado ${ageDays} días.`
          : 'Último mensaje enviado sin respuesta; se envió hoy.',
      }];
    });

    const dedupeSeen = new Set<string>();
    return pending
      .sort((left, right) => right.ageDays - left.ageDays || left.subject.localeCompare(right.subject))
      .filter((item) => {
        const key = `${item.client.toLowerCase()}|${item.subject.toLowerCase()}|${item.date?.slice(0, 16) ?? ''}`;
        if (dedupeSeen.has(key)) return false;
        dedupeSeen.add(key);
        return true;
      });
  })();
  followUpRequests.set(cacheKey, request);

  try {
    const pending = await request;
    followUpCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: pending });
    return pending.slice(0, maxResults);
  } finally {
    followUpRequests.delete(cacheKey);
  }
}

export async function listDetectedCommitments(email: string, maxResults = 10, analysisWindow = getAnalysisWindow(), ensureSnapshot = true) {
  const cacheKey = analysisCacheKey(email, analysisWindow);
  const cached = commitmentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value.slice(0, maxResults);

  const existingRequest = commitmentRequests.get(cacheKey);
  if (existingRequest) return (await existingRequest).slice(0, maxResults);

  const request = (async (): Promise<DetectedCommitment[]> => {
    const context = await listRecentMailboxContext(email, 10, analysisWindow, false, ensureSnapshot);
    const seen = new Set<string>();
    const commitments = context.flatMap((candidate) => candidate.threadMessages.flatMap((message) => {
      const owner = isMessageFromAccount(message.from, email) ? 'Tú' : message.from;
      const laterMessages = candidate.threadMessages.filter((item) => messageTimestamp(item) > messageTimestamp(message));
      const hasLaterReply = laterMessages.some((item) => isMessageFromAccount(item.from, email) !== (owner === 'Tú'));
      const overdue = message.dateHints.some((hint) => isPastExplicitDate(hint));
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
          status: overdue
            ? 'Posible incumplido'
            : hasLaterReply
              ? 'Pendiente de revisión'
              : owner === 'Tú'
                ? 'Pendiente de respuesta del cliente'
                : 'Pendiente de respuesta del comercial',
          reason: message.dateHints.length
            ? `Frase de solicitud, confirmación, envío o plazo detectada. Fechas/plazos: ${message.dateHints.join(', ')}.`
            : 'Frase de solicitud, confirmación, envío o plazo detectada en el hilo.',
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null);
    }));

    const dedupeCommitmentSeen = new Set<string>();
    return commitments
      .sort((left, right) => messageTimestamp(right) - messageTimestamp(left))
      .filter((item) => {
        const key = `${item.owner.toLowerCase()}|${item.subject.toLowerCase()}|${item.commitment.toLowerCase()}`;
        if (dedupeCommitmentSeen.has(key)) return false;
        dedupeCommitmentSeen.add(key);
        return true;
      });
  })();
  commitmentRequests.set(cacheKey, request);

  try {
    const commitments = await request;
    commitmentCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: commitments });
    return commitments.slice(0, maxResults);
  } finally {
    commitmentRequests.delete(cacheKey);
  }
}

async function loadRecentMailboxContext(email: string, maxPerFolder: number, analysisWindow: AnalysisWindow, includeBodies: boolean, ensureSnapshot: boolean): Promise<AnalysisMailboxContextMessage[]> {
  const limit = Math.max(maxPerFolder, getAnalysisMessageLimit());
  let candidates: Array<GmailListMessage & { mailbox: string }>;
  if (analysisWindow.scope === 'mailbox') {
    if (ensureSnapshot) await ensureGmailSnapshot(email, false, analysisWindow);
    const [inbox, sent] = await Promise.all([
      listAnalysisMessages(email, 'inbox', analysisWindow, limit, false),
      listAnalysisMessages(email, 'sent', analysisWindow, limit, false),
    ]);
    candidates = [
      ...inbox.map((message) => ({ ...message, mailbox: 'recibidos' })),
      ...sent.map((message) => ({ ...message, mailbox: 'enviados' })),
    ];
  } else {
    const messages = await listAnalysisMessagesForScope(email, analysisWindow, limit);
    candidates = messages.map((message) => ({
      ...message,
      mailbox: analysisWindow.scope === 'spam' ? 'spam' : 'todos',
    }));
  }

  const threadIds = [...new Set(candidates.map((message) => message.threadId).filter(Boolean))] as string[];
  const storedThreadEntries = new Map<string, GmailThreadMessage[]>();
  candidates.forEach((message) => {
    if (!message.threadId) return;
    const entries = storedThreadEntries.get(message.threadId) ?? [];
    entries.push({
      id: message.id,
      threadId: message.threadId,
      subject: message.subject,
      from: message.from,
      to: message.to,
      date: message.date,
      internalDate: message.date ? messageTimestamp(message) : null,
      body: message.snippet,
      dateHints: extractDateHints(message.snippet),
    });
    storedThreadEntries.set(message.threadId, entries);
  });
  let threadsById = storedThreadEntries;
  if (includeBodies) {
    const gmail = await getGmailClient(email);
    const threadEntries = await mapWithConcurrency(threadIds, 3, async (threadId) => [threadId, await getCachedThreadMessages(email, gmail, threadId)] as const);
    threadsById = new Map(threadEntries);
  }
  const fromTimestamp = Date.parse(`${analysisWindow.from.replaceAll('/', '-')}T00:00:00.000Z`);
  const toTimestamp = Date.parse(`${analysisWindow.to.replaceAll('/', '-')}T23:59:59.999Z`);

  return candidates.map((message) => ({
    ...message,
    threadMessages: (threadsById.get(message.threadId ?? '') ?? [])
      .filter((threadMessage) => {
        const timestamp = messageTimestamp(threadMessage);
        return timestamp >= fromTimestamp && timestamp <= toTimestamp;
      })
      .map((threadMessage) => ({
        ...threadMessage,
        body: threadMessage.body.slice(0, 8000),
      })),
  }));
}

export async function listRecentMailboxContext(email: string, maxPerFolder = 5, analysisWindow = getAnalysisWindow(), includeBodies = false, ensureSnapshot = true) {
  const cacheKey = mailboxContextCacheKey(email, maxPerFolder, analysisWindow, includeBodies, ensureSnapshot);
  const cached = mailboxContextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existingRequest = mailboxContextRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = loadRecentMailboxContext(email, maxPerFolder, analysisWindow, includeBodies, ensureSnapshot);
  mailboxContextRequests.set(cacheKey, request);
  try {
    const context = await request;
    mailboxContextCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: context });
    return context;
  } finally {
    mailboxContextRequests.delete(cacheKey);
  }
}

export async function getThreadMessages(email: string, threadId: string) {
  const gmail = await getGmailClient(email);
  return getCachedThreadMessages(email, gmail, threadId);
}

export async function listClientHistory(email: string, clientEmail: string, maxResults = 50) {
  const normalizedClient = clientEmail.trim().toLowerCase();
  if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(normalizedClient)) throw new Error('Correo de cliente no válido.');

  await ensureGmailSnapshot(email);
  const storedMessages = await findStoredGmailMessages(email, normalizedClient, maxResults);
  if (storedMessages.length > 0) {
    const gmail = await getGmailClient(email);
    const threadIds = [...new Set(storedMessages.map((message) => message.threadId).filter(Boolean))] as string[];
    const threads = await Promise.all(threadIds.map((threadId) => getCachedThreadMessages(email, gmail, threadId)));
    return threads
      .flat()
      .filter((message) => `${message.from} ${message.to}`.toLowerCase().includes(normalizedClient))
      .sort((left, right) => messageTimestamp(right) - messageTimestamp(left))
      .slice(0, Math.min(Math.max(maxResults, 1), 100));
  }

  const gmail = await getGmailClient(email);
  const listed = await gmail.users.messages.list({
    userId: 'me',
    q: `from:${normalizedClient} OR to:${normalizedClient}`,
    maxResults: Math.min(Math.max(maxResults, 1), 100),
  });
  const threadIds = [...new Set((listed.data.messages ?? []).map((message) => message.threadId).filter(Boolean))] as string[];
  const threads = await Promise.all(threadIds.map((threadId) => getCachedThreadMessages(email, gmail, threadId)));

  return threads
    .flat()
    .filter((message) => `${message.from} ${message.to}`.toLowerCase().includes(normalizedClient))
    .sort((left, right) => messageTimestamp(right) - messageTimestamp(left))
    .slice(0, Math.min(Math.max(maxResults, 1), 100));
}

async function getCachedThreadMessages(email: string, gmail: ReturnType<typeof google.gmail>, threadId: string) {
  const cacheKey = `${email.toLowerCase()}:${threadId}`;
  const cached = threadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const stored = await getStoredGmailThread(email, threadId);
  if (stored) {
    threadCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: stored });
    return stored;
  }

  const existingRequest = threadRequests.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = getThreadMessagesFromGmail(gmail, threadId);
  threadRequests.set(cacheKey, request);
  try {
    const messages = await request;
    threadCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: messages });
    return messages;
  } finally {
    threadRequests.delete(cacheKey);
  }
}

async function getThreadMessagesFromGmail(gmail: ReturnType<typeof google.gmail>, threadId: string) {
  const { data } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  return (data.messages ?? []).map((message) => {
    const headers = Object.fromEntries(
      (message.payload?.headers ?? []).map((header) => [header.name ?? '', header.value ?? '']),
    );

    const body = cleanEmailBody(extractText(message.payload));
    return {
      id: message.id ?? null,
      threadId: message.threadId ?? threadId,
      subject: headers.Subject || '(Sin asunto)',
      from: headers.From || '(Remitente desconocido)',
      to: headers.To || '',
      date: headers.Date || null,
      internalDate: message.internalDate ? Number(message.internalDate) : null,
      body,
      dateHints: extractDateHints(body),
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

function extractDateHints(body: string) {
  const patterns = [
    /\b(?:hoy|mañana|pasado mañana|esta semana|la semana que viene|el próximo lunes|el próximo martes|el próximo miércoles|el próximo jueves|el próximo viernes)\b/gi,
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g,
    /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de?\s*\d{4}\b/gi,
  ];
  return [...new Set(patterns.flatMap((pattern) => body.match(pattern) ?? []).map((value) => value.trim()))].slice(0, 5);
}

function isPastExplicitDate(value: string) {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!match) return false;
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : new Date().getFullYear();
  const timestamp = Date.UTC(year, Number(match[2]) - 1, Number(match[1]));
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

export function classifyFollowUp(thread: GmailThreadMessage[]) {
  const content = thread.map((message) => `${message.subject}\n${message.body}`).join('\n').toLowerCase();
  if (/\bbriefing\b|\bbrief\b/.test(content)) return 'Briefing pendiente';
  if (/\bpresupuesto(?:s)?\b|\bcotizaci[oó]n(?:es)?\b|\bquotation(?:s)?\b|\bquote(?:s)?\b|\bpricing\b|\bprecio(?:s)?\b|\bcoste(?:s)?\b|\bcosto(?:s)?\b|\btarifa(?:s)?\b|\bpropuesta\s+econ[oó]mica\b/.test(content)) return 'Posible presupuesto';
  if (/\bpropuesta(?:s)?\b|\boferta(?:s)?\b|\bproposal(?:s)?\b/.test(content)) return 'Posible propuesta';
  if (/\bbriefing\b|\binformaci[oó]n\b|\bdetalles?\b|\bconfirm(?:ar|aci[oó]n)\b|\bdatos\b|\balcance\b/.test(content)) return 'Solicitud de información';
  return 'Seguimiento general';
}

function looksLikeBounce(subject: string, snippet: string) {
  return /mail delivery subsystem|delivery status notification|delivery failed|failure notice|undeliverable|returned mail|message not delivered|mensaje no entregado|no se pudo entregar|correo rechazado/i.test(`${subject} ${snippet}`);
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
  const lines = redactSensitiveValues(decodeHtmlEntities(value))
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

  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, code: string) => {
      if (code.startsWith('#')) {
        const numericCode = code.slice(1);
        const number = numericCode.toLowerCase().startsWith('x')
          ? Number.parseInt(numericCode.slice(1), 16)
          : Number.parseInt(numericCode, 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : '';
      }
      return namedEntities[code.toLowerCase()] ?? match;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

async function listMessagesForLabel(
  gmail: ReturnType<typeof google.gmail>,
  label: 'INBOX' | 'SENT' | 'SPAM' | undefined,
  maxResults: number,
  pageToken?: string,
  query = '',
) {
  const listed = await gmail.users.messages.list({
    userId: 'me',
    ...(label ? { labelIds: [label] } : {}),
    maxResults: Math.min(Math.max(maxResults, 1), 50),
    pageToken,
    q: query || undefined,
  });

  const messages = await mapWithConcurrency(listed.data.messages ?? [], 3, async ({ id }) => {
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
        labelIds: data.labelIds ?? [],
        important: (data.labelIds ?? []).includes('IMPORTANT'),
        bounced: label === 'INBOX' && looksLikeBounce(headers.Subject || '', data.snippet ?? ''),
      };
    });

  return {
    messages: messages.filter((message): message is NonNullable<typeof message> => message !== null),
    nextPageToken: listed.data.nextPageToken ?? null,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(concurrency, 1), items.length || 1) }, worker));
  return results;
}

function extractEmailAddresses(value: string) {
  const matches = [...value.matchAll(/<([^>]+)>|([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi)]
    .map((match) => (match[1] ?? match[2]).trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(matches)];
}
