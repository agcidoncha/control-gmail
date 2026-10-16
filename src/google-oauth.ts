import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { loadGoogleTokens, saveGoogleTokens } from './token-store.js';
import {
  findStoredGmailMessages,
  getGmailSyncState,
  listAllStoredGmailMessages,
  listStoredGmailMessages,
  saveGmailSyncSnapshot,
  type StoredGmailMessage,
  type StoredMailbox,
  type StoredThreadMessage,
} from './gmail-store.js';
import { listGmailActions } from './gmail-action-store.js';
import { classifyFollowUpByRules, classifyFollowUpWithAi } from './follow-up-classifier.js';
import { classifyCommitmentWithAi } from './commitment-classifier.js';
import { resolveAiConnection } from './ai-connections.js';

const gmailModifyScope = 'https://www.googleapis.com/auth/gmail.modify';
const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';
const pendingStates = new Set<string>();
const gmailCacheTtlMs = 2 * 60_000;
const defaultAnalysisDays = 30;
const maxAnalysisDays = 3650;
const applicationTimeZone = process.env.APP_TIME_ZONE ?? 'Europe/Madrid';
const gmailDateQueryVersion = 2;

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
  internalDate?: number | null;
};

export type GmailMailbox = 'all' | 'inbox' | 'sent' | 'archived' | 'appArchived' | 'spam' | 'trash';

export type GmailMessageAction = 'markRead' | 'markUnread' | 'archive' | 'unarchive' | 'trash' | 'restore';

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
  labelIds?: string[];
};

type PendingFollowUp = {
  threadId: string;
  messageId: string | null;
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
  truncated: boolean;
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

function getMailboxDateQuery(fromValue?: string, toValue?: string) {
  if (!fromValue && !toValue) return '';
  const from = fromValue ? parseDateInput(fromValue, 'La fecha inicial') : null;
  const to = toValue ? parseDateInput(toValue, 'La fecha final') : null;
  if (from && to && from > to) throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  const clauses: string[] = [];
  if (from) {
    clauses.push(`after:${Math.floor(getApplicationDayTimestamp(fromValue!) / 1000)}`);
  }
  if (to) {
    clauses.push(`before:${Math.floor(getApplicationDayTimestamp(toValue!, 1) / 1000)}`);
  }
  return clauses.join(' ');
}

function parseDateInput(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} debe tener el formato AAAA-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatGmailDate(date).replaceAll('/', '-') !== value) {
    throw new Error(`${field} no es una fecha válida.`);
  }
  return date;
}

/** Medianoche del calendario de la aplicación, también en cambios de horario. */
export function getApplicationDayTimestamp(value: string, dayOffset = 0) {
  const date = parseDateInput(value.replaceAll('/', '-'), 'La fecha');
  date.setUTCDate(date.getUTCDate() + dayOffset);
  const target = date.getTime();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: applicationTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let timestamp = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const localTimestamp = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const next = target - (localTimestamp - timestamp);
    if (next === timestamp) break;
    timestamp = next;
  }
  return timestamp;
}

export function getApplicationDateInput(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: applicationTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getAnalysisWindow(input: AnalysisWindowInput = {}): AnalysisWindow {
  const today = parseDateInput(getApplicationDateInput(), 'La fecha actual');
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

  return {
    from: formatGmailDate(from),
    to: formatGmailDate(to),
    days,
    query: `after:${Math.floor(getApplicationDayTimestamp(formatGmailDate(from)) / 1000)} before:${Math.floor(getApplicationDayTimestamp(formatGmailDate(to), 1) / 1000)}`,
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

async function aiCacheIdentity(email: string) {
  try {
    const connection = await resolveAiConnection(email);
    return `${connection.provider}:${connection.model}`;
  } catch {
    return 'unavailable';
  }
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
  const sameWindow = state?.from === requestedWindow.from && state?.to === requestedWindow.to;
  if (!force && state?.queryVersion === gmailDateQueryVersion && coversWindow && (!state.truncated || sameWindow) && Number.isFinite(lastSyncedAt) && Date.now() - lastSyncedAt < getSyncIntervalMs()) return;

  const existingRequest = syncRequests.get(normalizedEmail);
  if (existingRequest) {
    await existingRequest;
    const refreshedState = await getGmailSyncState(normalizedEmail);
    const sameRefreshedWindow = refreshedState?.from === requestedWindow.from && refreshedState?.to === requestedWindow.to;
    if (refreshedState?.queryVersion === gmailDateQueryVersion && syncStateCoversWindow(refreshedState, requestedWindow) && (!refreshedState.truncated || sameRefreshedWindow)) return;
    // Compartir una sincronización solo es válido si cubre también las
    // fechas del segundo consumidor (Clientes, Seguimientos o Informes).
    return ensureGmailSnapshot(normalizedEmail, false, requestedWindow);
  }

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
  const sameWindow = existingState?.from === analysisWindow.from && existingState?.to === analysisWindow.to;
  if (existingState?.queryVersion === gmailDateQueryVersion && existingState.historyId && syncStateCoversWindow(existingState, analysisWindow) && (!existingState.truncated || sameWindow)) {
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
  const truncated = inbox.length >= limit || sent.length >= limit;
  const currentIds = new Set(messages.map((message) => message.id));
  const stored = truncated ? [] : (await Promise.all([
    listAllStoredGmailMessages(normalizedEmail, 'inbox'),
    listAllStoredGmailMessages(normalizedEmail, 'sent'),
  ])).flat();
  const fromTimestamp = getApplicationDayTimestamp(analysisWindow.from);
  const toTimestamp = getApplicationDayTimestamp(analysisWindow.to, 1);
  const removedMessageIds = stored.filter((message) => message.sortTimestamp >= fromTimestamp && message.sortTimestamp < toTimestamp && !currentIds.has(message.id)).map((message) => message.id);
  const threads: StoredThreadMessage[][] = [];
  const { data: profile } = await gmail.users.getProfile({ userId: 'me' });

  await saveGmailSyncSnapshot({
    email: normalizedEmail,
    messages,
    threads,
    removedMessageIds,
    syncState: {
      queryVersion: gmailDateQueryVersion,
      accountEmail: normalizedEmail,
      from: analysisWindow.from,
      to: analysisWindow.to,
      lastSyncedAt: new Date().toISOString(),
      messageCount: messages.length,
      threadCount: threads.length,
      truncated,
      historyId: profile.historyId ?? undefined,
    },
  });
}

export async function refreshGmailAccount(email: string, analysisWindow = getAnalysisWindow()) {
  await ensureGmailSnapshot(email, true, analysisWindow);
  clearAccountCaches(email);
  const state = await getGmailSyncState(email);
  return {
    syncedAt: state?.lastSyncedAt ?? new Date().toISOString(),
    from: state?.from ?? null,
    to: state?.to ?? null,
  };
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
    const inWindow = timestamp >= getApplicationDayTimestamp(analysisWindow.from)
      && timestamp < getApplicationDayTimestamp(analysisWindow.to, 1);
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
  const subject = decodeGmailHeader(headers.Subject || '(Sin asunto)');
  const from = decodeGmailHeader(headers.From || '(Remitente desconocido)');
  const to = decodeGmailHeader(headers.To || '');
  return {
    id,
    threadId: data.threadId ?? null,
    subject,
    from,
    to,
    date: headers.Date || null,
    snippet: cleanEmailBody(data.snippet ?? ''),
    labelIds: data.labelIds ?? [],
    important: (data.labelIds ?? []).includes('IMPORTANT'),
    bounced: (data.labelIds ?? []).includes('INBOX') && looksLikeBounce(subject, data.snippet ?? ''),
    internalDate: Number(data.internalDate) || null,
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
    subject: decodeGmailHeader(message.subject),
    from: decodeGmailHeader(message.from),
    to: decodeGmailHeader(message.to),
    date: message.date,
    snippet: message.snippet,
    labelIds: message.labelIds,
    important: message.important,
    bounced: message.bounced,
    internalDate: message.sortTimestamp,
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
  } else if (action === 'restore') {
    await gmail.users.messages.untrash({ userId: 'me', id: messageId });
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { addLabelIds: ['INBOX'], removeLabelIds: ['TRASH'] } });
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

// En Gmail, archivar quita INBOX pero no necesariamente elimina SENT de un
// hilo. No excluimos SENT para que la vista pueda recuperar también esos hilos.
const archivedMailboxQuery = '-in:inbox -in:spam -in:trash -in:drafts';

export async function listRecentMessages(email: string, maxResults = 10, mailbox: GmailMailbox = 'inbox', query = '', organizationId = process.env.DEFAULT_ORGANIZATION_ID ?? 'org_publicidad_segmentada_tv') {
  if (mailbox === 'appArchived') {
    const messages = await listAppArchivedMessages(email, organizationId, maxResults);
    return messages.messages.filter((message) => !query || `${message.subject} ${message.from} ${message.to} ${message.snippet}`.toLowerCase().includes(query.toLowerCase()));
  }
  if (mailbox === 'archived' || mailbox === 'spam' || mailbox === 'trash') {
    const cacheKey = messageCacheKey(email, mailbox, query);
    const cached = messageCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && cached.value.length >= maxResults) {
      return cached.value.slice(0, maxResults);
    }

    const existingRequest = messageRequests.get(cacheKey);
    if (existingRequest) return (await existingRequest).slice(0, maxResults);

    const request = (async () => {
      const gmail = await getGmailClient(email);
      const label = mailbox === 'spam' ? 'SPAM' : mailbox === 'trash' ? 'TRASH' : undefined;
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

  if (mailbox === 'all') {
    const gmail = await getGmailClient(email);
    return listMessagesForLabel(gmail, undefined, maxResults, undefined, query);
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
  dateFrom?: string,
  dateTo?: string,
  fetchAll = false,
  searchQuery = '',
) {
  const dateQuery = getMailboxDateQuery(dateFrom, dateTo);
  if (mailbox === 'appArchived') {
    if (fetchAll && dateQuery) {
      const messages: GmailListMessage[] = [];
      let offset = 0;
      while (true) {
        const page = await listAppArchivedMessages(email, organizationId, 50, offset, dateFrom, dateTo);
        messages.push(...page.messages);
        if (page.nextOffset === null) return { messages, nextPageToken: null, truncated: false };
        if (messages.length >= mailboxDateResultLimit) {
          return { messages: messages.slice(0, mailboxDateResultLimit), nextPageToken: null, truncated: true };
        }
        offset = page.nextOffset;
      }
    }
    const offset = decodePageOffset(pageToken);
    const page = await listAppArchivedMessages(email, organizationId, maxResults, offset, dateFrom, dateTo);
    return {
      messages: page.messages,
      nextPageToken: page.nextOffset === null ? null : encodePageOffset(page.nextOffset),
      truncated: false,
    };
  }
  if (mailbox === 'archived' || mailbox === 'spam' || mailbox === 'trash') {
    const cacheKey = messageCacheKey(email, mailbox, dateQuery);
    if (forceRefresh) {
      messageCache.delete(cacheKey);
      nextPageTokenCache.delete(cacheKey);
    }
    if (fetchAll && dateQuery && !pageToken) {
      return listAllMessagesForLabelCached(email, mailbox, mailbox === 'spam' ? 'SPAM' : mailbox === 'trash' ? 'TRASH' : undefined, [mailbox === 'archived' ? archivedMailboxQuery : '', dateQuery, searchQuery].filter(Boolean).join(' '));
    }
    if (!pageToken && !searchQuery) {
      const messages = await listRecentMessages(email, maxResults, mailbox, dateQuery);
      return {
        messages,
        nextPageToken: nextPageTokenCache.get(cacheKey) ?? null,
        truncated: false,
      };
    }

    const gmail = await getGmailClient(email);
    const label = mailbox === 'spam' ? 'SPAM' : mailbox === 'trash' ? 'TRASH' : undefined;
    const query = [mailbox === 'archived' ? archivedMailboxQuery : '', dateQuery, searchQuery].filter(Boolean).join(' ');
    if (fetchAll && dateQuery) return listAllMessagesForLabel(gmail, label, query);
    return listMessagesForLabel(gmail, label, maxResults, pageToken, query);
  }

  if (mailbox === 'all') {
    const gmail = await getGmailClient(email);
    const query = ['{in:inbox in:sent}', dateQuery, searchQuery].filter(Boolean).join(' ');
    return listMessagesForLabel(gmail, undefined, maxResults, pageToken, query);
  }

  if (dateQuery) {
    const label = mailbox === 'sent' ? 'SENT' : 'INBOX';
    const storedResult = searchQuery ? null : await listStoredMessagesForDateRangePage(email, mailbox === 'sent' ? 'sent' : 'inbox', maxResults, pageToken, dateFrom, dateTo);
    if (storedResult) return storedResult;
    const gmail = await getGmailClient(email);
    return listMessagesForLabel(gmail, label, maxResults, pageToken, [dateQuery, searchQuery].filter(Boolean).join(' '));
  }

  await ensureGmailSnapshot(email, forceRefresh);
  const page = await listStoredGmailMessages(email, mailbox, maxResults, decodePageOffset(pageToken));
  return {
    messages: page.messages.map(fromStoredMessage),
    nextPageToken: page.nextOffset === null ? null : encodePageOffset(page.nextOffset),
    truncated: false,
  };
}

const mailboxDateResultLimit = 1000;

async function listStoredMessagesForDateRangePage(
  email: string,
  mailbox: 'inbox' | 'sent',
  maxResults: number,
  pageToken: string | undefined,
  dateFrom?: string,
  dateTo?: string,
) {
  const requestedWindow = getAnalysisWindow({ from: dateFrom, to: dateTo });
  await ensureGmailSnapshot(email, false, requestedWindow);
  const state = await getGmailSyncState(email);
  // A truncated local snapshot cannot prove that this date range is complete.
  // Fall back to Gmail's paginated query so an incomplete snapshot cannot
  // produce an empty page together with a misleading "too many results" warning.
  if (!state || state.queryVersion !== gmailDateQueryVersion || state.truncated || !syncStateCoversWindow(state, requestedWindow)) return null;

  const fromTimestamp = getApplicationDayTimestamp(requestedWindow.from);
  const toTimestamp = getApplicationDayTimestamp(requestedWindow.to, 1) - 1;
  const filteredMessages = (await listAllStoredGmailMessages(email, mailbox))
    .filter((message) => message.sortTimestamp >= fromTimestamp && message.sortTimestamp <= toTimestamp)
    .map(fromStoredMessage);
  const offset = decodePageOffset(pageToken);
  const size = Math.min(Math.max(maxResults, 1), 50);
  const messages = filteredMessages.slice(offset, offset + size);
  const pageCount = Math.max(1, Math.ceil(filteredMessages.length / size));
  return {
    messages,
    nextPageToken: offset + messages.length < filteredMessages.length ? encodePageOffset(offset + messages.length) : null,
    pageCount,
    pageTokens: Array.from({ length: pageCount }, (_, index) => index === 0 ? null : encodePageOffset(index * size)),
    truncated: Boolean(state.truncated),
  };
}

async function listAllMessagesForLabelCached(
  email: string,
  mailbox: GmailMailbox,
  label: 'INBOX' | 'SENT' | 'SPAM' | 'TRASH' | undefined,
  query: string,
) {
  const cacheKey = messageCacheKey(email, mailbox, `${query}:all`);
  const cached = messageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { messages: cached.value, nextPageToken: null, truncated: cached.value.length >= mailboxDateResultLimit };
  }

  const existingRequest = messageRequests.get(cacheKey);
  if (existingRequest) {
    const messages = await existingRequest;
    return { messages, nextPageToken: null, truncated: messages.length >= mailboxDateResultLimit };
  }

  const request = (async () => {
    const gmail = await getGmailClient(email);
    return listAllMessagesForLabel(gmail, label, query);
  })();
  messageRequests.set(cacheKey, request.then((result) => result.messages));
  try {
    const result = await request;
    messageCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: result.messages });
    return result;
  } finally {
    messageRequests.delete(cacheKey);
  }
}

async function listAllMessagesForLabel(
  gmail: ReturnType<typeof google.gmail>,
  label: 'INBOX' | 'SENT' | 'SPAM' | 'TRASH' | undefined,
  query: string,
) {
  const messages: GmailListMessage[] = [];
  let pageToken: string | undefined;
  while (true) {
    const page = await listMessagesForLabel(gmail, label, 50, pageToken, query);
    messages.push(...page.messages);
    if (!page.nextPageToken) return { messages, nextPageToken: null, truncated: false };
    if (messages.length >= mailboxDateResultLimit) {
      return { messages: messages.slice(0, mailboxDateResultLimit), nextPageToken: null, truncated: true };
    }
    pageToken = page.nextPageToken;
  }
}

async function listAppArchivedMessages(email: string, organizationId: string, maxResults: number, offset = 0, dateFrom?: string, dateTo?: string) {
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
  const fromTimestamp = dateFrom ? getApplicationDayTimestamp(dateFrom) : Number.NEGATIVE_INFINITY;
  const toTimestamp = dateTo ? getApplicationDayTimestamp(dateTo, 1) - 1 : Number.POSITIVE_INFINITY;
  const archived = currentMessages.filter((message): message is GmailListMessage => {
    if (!message) return false;
    const timestamp = messageTimestamp(message);
    return timestamp >= fromTimestamp
      && timestamp <= toTimestamp
      && !message.labelIds.includes('INBOX')
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
  const stored = await listAllStoredGmailMessages(email, mailbox);
  const fromTimestamp = getApplicationDayTimestamp(analysisWindow.from);
  const toTimestamp = getApplicationDayTimestamp(analysisWindow.to, 1) - 1;
  return stored
    .filter((message) => message.sortTimestamp >= fromTimestamp && message.sortTimestamp <= toTimestamp)
    .slice(0, maxMessages)
    .map(fromStoredMessage);
}

async function listAnalysisMessagesForScope(email: string, analysisWindow: AnalysisWindow, maxMessages = getAnalysisMessageLimit()) {
  const gmail = await getGmailClient(email);
  const label = analysisWindow.scope === 'spam' ? 'SPAM' : undefined;
  return listAnalysisMessagesWithClient(gmail, label, analysisWindow, maxMessages);
}

async function listAnalysisMessagesWithClient(
  gmail: ReturnType<typeof google.gmail>,
  label: 'INBOX' | 'SENT' | 'SPAM' | 'TRASH' | undefined,
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
  const messageLimit = Math.max(Math.min(Math.max(Math.floor(maxResults) || 25, 1), 1000), getAnalysisMessageLimit());
  const cacheKey = `${analysisCacheKey(email, analysisWindow)}:insights:${messageLimit}`;
  const cached = insightsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const scopedMessages = analysisWindow.scope === 'mailbox' ? null : await listAnalysisMessagesForScope(email, analysisWindow, messageLimit);
  const [inbox, sent] = scopedMessages
    ? [scopedMessages.filter((message) => !isMessageFromAccount(message.from, email)), scopedMessages.filter((message) => isMessageFromAccount(message.from, email))]
    : await Promise.all([
        listAnalysisMessages(email, 'inbox', analysisWindow, messageLimit),
        listAnalysisMessages(email, 'sent', analysisWindow, messageLimit),
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
    truncated: analysisWindow.scope === 'mailbox'
      ? Boolean((await getGmailSyncState(email))?.truncated)
      : inbox.length + sent.length >= messageLimit,
  };
  insightsCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: insights });
  return insights;
}

export async function listPendingFollowUps(email: string, maxResults = 10, analysisWindow = getAnalysisWindow(), ensureSnapshot = true, contextMaxPerFolder = getSyncMessageLimit()) {
  const cacheKey = `${analysisCacheKey(email, analysisWindow)}:followups:${contextMaxPerFolder}:${await aiCacheIdentity(email)}`;
  const cached = followUpCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value.slice(0, maxResults);

  const existingRequest = followUpRequests.get(cacheKey);
  if (existingRequest) return (await existingRequest).slice(0, maxResults);

  const request = (async (): Promise<PendingFollowUp[]> => {
    // Los seguimientos no deben quedar limitados al contexto de IA. La interfaz
    // pagina los resultados, pero aquí necesitamos calcular el total y los
    // avisos de antigüedad del periodo seleccionado.
    const context = await listRecentMailboxContext(email, contextMaxPerFolder, analysisWindow, false, ensureSnapshot);
    const storedThreads = new Map<string, GmailThreadMessage[]>();
    context.forEach((candidate) => {
      if (!candidate.threadId) return;
      const current = storedThreads.get(candidate.threadId) ?? [];
      current.push(...candidate.threadMessages);
      storedThreads.set(candidate.threadId, current);
    });
    // Solo necesitan refrescarse los hilos cuya última actividad visible es
    // un envío nuestro. Si el último mensaje visible ya es del cliente, ese
    // hilo no puede ser un seguimiento pendiente en este momento. Así se evita
    // consultar Gmail para cada hilo del periodo.
    const threadIds = [...storedThreads.entries()]
      .filter(([, thread]) => {
        const lastMessage = [...thread]
          .sort((left, right) => messageTimestamp(left) - messageTimestamp(right))
          .at(-1);
        return Boolean(lastMessage && isMessageFromAccount(lastMessage.from, email));
      })
      .map(([threadId]) => threadId);
    const freshThreads = await getFreshThreadMessagesForFollowUps(email, threadIds);
    const threads = new Map<string, GmailThreadMessage[]>();
    context.forEach((candidate) => {
      if (!candidate.threadId) return;
      const current = threads.get(candidate.threadId) ?? freshThreads.get(candidate.threadId) ?? candidate.threadMessages;
      threads.set(candidate.threadId, current);
    });
    const periodEnd = getApplicationDayTimestamp(analysisWindow.to, 1) - 1;
    const pending = (await mapWithConcurrency([...threads.values()], 3, async (thread) => {
      const ordered = [...thread].sort((left, right) => messageTimestamp(left) - messageTimestamp(right));
      const lastMessage = ordered.at(-1);
      const lastTimestamp = lastMessage ? messageTimestamp(lastMessage) : 0;
      // El periodo localiza los hilos, pero el estado se comprueba con el hilo
      // completo y hasta hoy. Así una respuesta posterior al rango elimina el
      // falso seguimiento. Si la última actividad queda fuera del periodo, el
      // hilo tampoco pertenece a los resultados de ese periodo.
      // Si el último mensaje enviado se ha movido a la papelera (o a spam),
      // ya no debe seguir apareciendo como respuesta pendiente.
      if (!lastMessage || !lastTimestamp || lastTimestamp > periodEnd || !isMessageFromAccount(lastMessage.from, email) || (lastMessage.labelIds ?? []).includes('TRASH') || (lastMessage.labelIds ?? []).includes('SPAM')) return [];
      const recipients = extractEmailAddresses(lastMessage.to);
      if (recipients.length && recipients.every((recipient) => recipient === email.toLowerCase())) return [];

      const timestamp = messageTimestamp(lastMessage);
      if (!timestamp) return [];

      const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
      const ruleCategory = classifyFollowUpByRules(ordered);
      const category = ruleCategory ?? await classifyFollowUpWithAi(email, ordered);
      return [{
        threadId: lastMessage.threadId,
        messageId: lastMessage.id,
        client: lastMessage.to || '(Destinatario desconocido)',
        subject: lastMessage.subject,
        date: lastMessage.date,
        ageDays,
        category,
        reason: ageDays > 0
          ? `Último mensaje enviado sin respuesta; han pasado ${ageDays} días.`
          : 'Último mensaje enviado sin respuesta; se envió hoy.',
      }];
    })).flat();

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

async function getFreshThreadMessagesForFollowUps(email: string, threadIds: string[]) {
  if (!threadIds.length) return new Map<string, GmailThreadMessage[]>();
  const gmail = await getGmailClient(email);
  // Las búsquedas amplias pueden reunir muchos hilos. Reducimos la presión
  // sobre la cuota por usuario de Gmail cuando hay un lote grande.
  const concurrency = threadIds.length > 20 ? 1 : 2;
  const entries = await mapWithConcurrency(threadIds, concurrency, async (threadId) => {
    const cacheKey = `${email.toLowerCase()}:${threadId}`;
    const request = threadRequests.get(cacheKey) ?? getThreadMessagesFromGmailWithRetry(gmail, threadId);
    threadRequests.set(cacheKey, request);
    try {
      const messages = await request;
      threadCache.set(cacheKey, { expiresAt: Date.now() + gmailCacheTtlMs, value: messages });
      return [threadId, messages] as const;
    } finally {
      if (threadRequests.get(cacheKey) === request) threadRequests.delete(cacheKey);
    }
  });
  return new Map(entries);
}

async function getThreadMessagesFromGmailWithRetry(gmail: ReturnType<typeof google.gmail>, threadId: string, attempt = 0): Promise<GmailThreadMessage[]> {
  try {
    return await getThreadMessagesFromGmail(gmail, threadId);
  } catch (error) {
    if (!isGmailRateLimitError(error) || attempt >= 3) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
    return getThreadMessagesFromGmailWithRetry(gmail, threadId, attempt + 1);
  }
}

function isGmailRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /quota exceeded|user.?rate.?limit|rate.?limit|too many requests|resource.?exhausted/i.test(message);
}

export async function listPendingFollowUpsPage(
  email: string,
  maxResults = 10,
  page = 1,
  analysisWindow = getAnalysisWindow(),
  ageFilter = 'all',
  category = 'all',
  search = '',
) {
  const allFollowUps = await listPendingFollowUps(email, 2 * Math.max(getSyncMessageLimit(), getAnalysisMessageLimit()), analysisWindow, true, getSyncMessageLimit());
  const syncState = analysisWindow.scope === 'mailbox' ? await getGmailSyncState(email) : null;
  const normalizedPageSize = Math.min(Math.max(Number(maxResults) || 10, 1), 50);
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const query = search.trim().toLowerCase();
  const filtered = allFollowUps.filter((item) => {
    const ageMatches = ageFilter === '5-9'
      ? item.ageDays >= 5 && item.ageDays < 10
      : ageFilter === '10-14'
        ? item.ageDays >= 10 && item.ageDays < 15
        : ageFilter === '15+'
          ? item.ageDays >= 15
          : true;
    return ageMatches && (category === 'all' || item.category === category)
      && (!query || [item.client, item.subject, item.reason].join(' ').toLowerCase().includes(query));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / normalizedPageSize));
  const currentPage = Math.min(normalizedPage, pageCount);
  const offset = (currentPage - 1) * normalizedPageSize;
  return {
    followUps: filtered.slice(offset, offset + normalizedPageSize),
    total: filtered.length,
    page: currentPage,
    pageCount,
    truncated: Boolean(syncState?.truncated),
    summary: {
      total: allFollowUps.length,
      from5To9Days: allFollowUps.filter((item) => item.ageDays >= 5 && item.ageDays < 10).length,
      from10To14Days: allFollowUps.filter((item) => item.ageDays >= 10 && item.ageDays < 15).length,
      from15Days: allFollowUps.filter((item) => item.ageDays >= 15).length,
    },
  };
}

export async function listDetectedCommitments(email: string, maxResults = 10, analysisWindow = getAnalysisWindow(), ensureSnapshot = true) {
  const cacheKey = `${analysisCacheKey(email, analysisWindow)}:commitments:${await aiCacheIdentity(email)}`;
  const cached = commitmentCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value.slice(0, maxResults);

  const existingRequest = commitmentRequests.get(cacheKey);
  if (existingRequest) return (await existingRequest).slice(0, maxResults);

  const request = (async (): Promise<DetectedCommitment[]> => {
    const context = await listRecentMailboxContext(email, getSyncMessageLimit(), analysisWindow, false, ensureSnapshot);
    // El snippet de Gmail puede terminar antes de una promesa o una fecha.
    // Cada hilo se consulta una sola vez; se extraen señales de los mensajes
    // del periodo y se validan con el contexto completo, incluidas respuestas
    // posteriores al rango.
    const threadIds = [...new Set(context.map((candidate) => candidate.threadId).filter((id): id is string => Boolean(id)))];
    const threads = await getFreshThreadMessagesForFollowUps(email, threadIds);
    const fromTimestamp = getApplicationDayTimestamp(analysisWindow.from);
    const toTimestamp = getApplicationDayTimestamp(analysisWindow.to, 1) - 1;
    const seen = new Set<string>();
    const candidates = [...threads.values()].flatMap((threadMessages) => threadMessages.flatMap((message) => {
      const timestamp = messageTimestamp(message);
      if (timestamp < fromTimestamp || timestamp > toTimestamp || (message.labelIds ?? []).some((label) => label === 'TRASH' || label === 'SPAM')) return [];
      const commitments = extractCommitmentSentences(message.body);
      if (!commitments.length) return [];
      const owner = isMessageFromAccount(message.from, email) ? 'Tú' : message.from;
      const laterMessages = threadMessages.filter((item) => messageTimestamp(item) > messageTimestamp(message));
      const hasLaterReply = laterMessages.some((item) => isMessageFromAccount(item.from, email) !== (owner === 'Tú'));
      return [{ threadMessages, message, owner, hasLaterReply, commitments }];
    }));

    const evaluated = await mapWithConcurrency(candidates, 3, async ({ threadMessages, message, owner, hasLaterReply, commitments }) => {
      const decision = await classifyCommitmentWithAi(email, threadMessages, commitments.join(' '));
      if (!decision.isCommitment) return [];
      const overdue = message.dateHints.some((hint) => isPastExplicitDate(hint));
      return commitments.map((commitment) => {
        const key = `${message.threadId}:${commitment.toLowerCase()}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          threadId: message.threadId,
          owner,
          subject: message.subject,
          date: message.date,
          commitment,
          status: decision.source === 'unavailable'
            ? 'Validación IA no disponible'
            : decision.requiresReview
              ? 'Revisión humana'
            : overdue
              ? 'Posible incumplido'
              : hasLaterReply
                ? 'Pendiente de revisión'
              : 'Posible acción pendiente',
          reason: `${decision.source === 'unavailable'
            ? 'No se pudo validar este candidato con el modelo activo. Revisa el hilo completo antes de actuar.'
            : decision.requiresReview
              ? 'El modelo actual no tiene suficiente confianza para confirmarlo. Si necesitas una valoración más precisa, prueba con un modelo superior al configurado y revisa el hilo completo antes de actuar.'
              : `La IA ha detectado una posible tarea, promesa o respuesta pendiente. ${decision.reason} Comprueba en el hilo quién debe actuar.`} ${message.dateHints.length
              ? `Fechas/plazos: ${message.dateHints.join(', ')}.`
              : ''}`.trim(),
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null);
    });
    const commitments = evaluated.flat();

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
      labelIds: message.labelIds ?? [],
    });
    storedThreadEntries.set(message.threadId, entries);
  });
  let threadsById = storedThreadEntries;
  if (includeBodies) {
    const gmail = await getGmailClient(email);
    const threadEntries = await mapWithConcurrency(threadIds, 3, async (threadId) => [threadId, await getCachedThreadMessages(email, gmail, threadId)] as const);
    threadsById = new Map(threadEntries);
  }
  const fromTimestamp = getApplicationDayTimestamp(analysisWindow.from);
  const toTimestamp = getApplicationDayTimestamp(analysisWindow.to, 1) - 1;

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

export async function getMessageMetadata(email: string, messageId: string) {
  if (!messageId || !/^[\w-]+$/.test(messageId)) throw new Error('Identificador de mensaje no válido.');
  const gmail = await getGmailClient(email);
  return getGmailMessageMetadata(gmail, messageId);
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

export async function listClientAnalysisContext(email: string, clientEmail: string, analysisWindow = getAnalysisWindow(), maxResults = 100): Promise<AnalysisMailboxContextMessage[]> {
  const normalizedClient = clientEmail.trim().toLowerCase();
  if (!/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(normalizedClient)) throw new Error('Correo de cliente no válido.');

  const gmail = await getGmailClient(email);
  const scopeQuery = analysisWindow.scope === 'spam'
    ? 'in:spam'
    : analysisWindow.scope === 'all'
      ? 'in:anywhere'
      : '{in:inbox in:sent}';
  const listed = await gmail.users.messages.list({
    userId: 'me',
    q: `{from:${normalizedClient} to:${normalizedClient}} ${scopeQuery} ${analysisWindow.query}`.trim(),
    maxResults: Math.min(Math.max(maxResults, 1), 100),
  });
  const listedMessages = (listed.data.messages ?? []).filter((message) => message.id && message.threadId);
  const selectedIds = new Set(listedMessages.map((message) => message.id));
  const threadIds = [...new Set(listedMessages.map((message) => message.threadId).filter(Boolean))] as string[];
  const threads = await Promise.all(threadIds.map((threadId) => getCachedThreadMessages(email, gmail, threadId)));
  const fromTimestamp = getApplicationDayTimestamp(analysisWindow.from);
  const toTimestamp = getApplicationDayTimestamp(analysisWindow.to, 1) - 1;
  const messages = threads
    .flat()
    .filter((message) => {
      const participants = `${message.from} ${message.to}`.toLowerCase();
      const timestamp = messageTimestamp(message);
      return message.id && selectedIds.has(message.id) && participants.includes(normalizedClient) && timestamp >= fromTimestamp && timestamp <= toTimestamp;
    })
    .sort((left, right) => messageTimestamp(right) - messageTimestamp(left));

  const threadMessagesById = new Map<string, GmailThreadMessage[]>();
  messages.forEach((message) => {
    const entries = threadMessagesById.get(message.threadId) ?? [];
    entries.push({ ...message, body: message.body.slice(0, 8000) });
    threadMessagesById.set(message.threadId, entries);
  });

  return messages.map((message) => ({
    id: message.id ?? `${message.threadId}:${messageTimestamp(message)}`,
    threadId: message.threadId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    snippet: message.body.slice(0, 1000),
    labelIds: [],
    important: false,
    bounced: false,
    mailbox: 'cliente',
    threadMessages: threadMessagesById.get(message.threadId) ?? [message],
  }));
}

async function getCachedThreadMessages(email: string, gmail: ReturnType<typeof google.gmail>, threadId: string) {
  const cacheKey = `${email.toLowerCase()}:${threadId}`;
  const cached = threadCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Un hilo persistido puede ser anterior a una respuesta nueva. Solo se
  // reutiliza la caché corta de esta sesión; al caducar se consulta Gmail.
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
    const subject = decodeGmailHeader(headers.Subject || '(Sin asunto)');
    const from = decodeGmailHeader(headers.From || '(Remitente desconocido)');
    const to = decodeGmailHeader(headers.To || '');

    const body = cleanEmailBody(extractText(message.payload));
    return {
      id: message.id ?? null,
      threadId: message.threadId ?? threadId,
      subject,
      from,
      to,
      date: headers.Date || null,
      internalDate: message.internalDate ? Number(message.internalDate) : null,
      body,
      dateHints: extractDateHints(body),
      labelIds: message.labelIds ?? [],
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
  const commitmentPattern = /\b(?:te\s+enviar(?:é|e|emos)|enviar(?:é|e|emos)|quedo\s+a\s+la\s+espera|confirm(?:ar|ación|ame|es)|necesit(?:o|amos)\s+que|puedes\s+confirmar|avis(?:a|ar|en)|borr(?:ar|e|emos)|revoc(?:ar|ación)|rotar|termin(?:en|ar)|please\s+confirm|will\s+send|waiting\s+for|let\s+me\s+know|need\s+you\s+to|deadline)(?![\p{L}\p{N}_])/iu;
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
  return classifyFollowUpByRules(thread) ?? 'Seguimiento general';
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

const cp1252SpecialCharacters: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function decodeHeaderBytes(bytes: Uint8Array, charset: string): string {
  const normalizedCharset = charset.toLowerCase().replace(/[_-]/g, '');
  if (normalizedCharset === 'utf8' || normalizedCharset === 'usascii' || normalizedCharset === 'ascii') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (normalizedCharset === 'iso88591' || normalizedCharset === 'latin1' || normalizedCharset === 'windows1252' || normalizedCharset === 'cp1252') {
    return new TextDecoder('windows-1252').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeEncodedHeaderWord(charset: string, encoding: string, value: string): string {
  if (encoding.toLowerCase() === 'b') {
    try {
      return decodeHeaderBytes(Buffer.from(value, 'base64'), charset);
    } catch {
      return value;
    }
  }

  const bytes: number[] = [];
  const quoted = value.replace(/_/g, ' ');
  for (let index = 0; index < quoted.length; index += 1) {
    if (quoted[index] === '=' && /^[0-9a-f]{2}$/i.test(quoted.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(quoted.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      const codePoint = quoted.codePointAt(index) ?? 0;
      bytes.push(codePoint <= 0xff ? codePoint : 0x3f);
      if (codePoint > 0xffff) index += 1;
    }
  }
  return decodeHeaderBytes(Uint8Array.from(bytes), charset);
}

function repairMojibake(value: string): string {
  let repaired = value;
  for (let pass = 0; pass < 2; pass += 1) {
    if (!/[ÃÂâ€šœžŸƒ]/.test(repaired)) break;
    const bytes = Uint8Array.from(Array.from(repaired, (character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return cp1252SpecialCharacters[character] ?? (codePoint <= 0xff ? codePoint : 0x3f);
    }));
    try {
      const candidate = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (candidate === repaired) break;
      repaired = candidate;
    } catch {
      break;
    }
  }
  return repaired;
}

function decodeGmailHeader(value: string): string {
  const decoded = value.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, encodedValue: string) => (
    decodeEncodedHeaderWord(charset, encoding, encodedValue)
  ));
  return repairMojibake(decoded);
}

async function listMessagesForLabel(
  gmail: ReturnType<typeof google.gmail>,
  label: 'INBOX' | 'SENT' | 'SPAM' | 'TRASH' | undefined,
  maxResults: number,
  pageToken?: string,
  query = '',
) {
  const listed = await withGmailRateLimitRetry(() => gmail.users.messages.list({
    userId: 'me',
    ...(label ? { labelIds: [label] } : {}),
    maxResults: Math.min(Math.max(maxResults, 1), 50),
    pageToken,
    q: query || undefined,
  }));

  const messages = await mapWithConcurrency(listed.data.messages ?? [], 2, async ({ id }) => {
      if (!id) return null;
      const { data } = await withGmailRateLimitRetry(() => gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      }));
      const headers = Object.fromEntries(
        (data.payload?.headers ?? []).map((header) => [header.name ?? '', header.value ?? '']),
      );
      const subject = decodeGmailHeader(headers.Subject || '(Sin asunto)');
      const from = decodeGmailHeader(headers.From || '(Remitente desconocido)');
      const to = decodeGmailHeader(headers.To || '');

      return {
        id,
        threadId: data.threadId ?? null,
        subject,
        from,
        to,
        date: headers.Date || null,
        snippet: cleanEmailBody(data.snippet ?? ''),
        labelIds: data.labelIds ?? [],
        important: (data.labelIds ?? []).includes('IMPORTANT'),
        bounced: label === 'INBOX' && looksLikeBounce(subject, data.snippet ?? ''),
      };
    });

  return {
    messages: messages.filter((message): message is NonNullable<typeof message> => message !== null),
    nextPageToken: listed.data.nextPageToken ?? null,
    resultSizeEstimate: listed.data.resultSizeEstimate ?? null,
    truncated: false,
  };
}

async function withGmailRateLimitRetry<T>(operation: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isGmailRateLimitError(error) || attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    return withGmailRateLimitRetry(operation, attempt + 1);
  }
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
