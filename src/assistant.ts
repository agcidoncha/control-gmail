import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { getAnalysisWindow, listRecentMailboxContext, type AnalysisWindow } from './google-oauth.js';
import { resolveAiConnection } from './ai-connections.js';
import { askClaude, parseCommercialAnalysis, type CommercialAnalysis } from './claude.js';

const rulesPath = resolve('docs/reglas-seguridad-trabajo-con-ia.md');
const agentSpecPath = resolve('docs/agente-asistente-comercial-openai.md');
const analysisResultCache = new Map<string, { expiresAt: number; value: CommercialAnalysis }>();
const analysisResultCacheTtlMs = 10 * 60 * 1000;
const defaultContextThreads = 12;
const defaultContextMessagesPerThread = 3;
const defaultContextBodyChars = 1200;
const defaultContextSnippetChars = 500;

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    respuesta: { type: 'string' },
    hechos: { type: 'array', items: { type: 'string' } },
    inferencias: { type: 'array', items: { type: 'string' } },
    acciones_propuestas: { type: 'array', items: { type: 'string' } },
    requiere_revision: { type: 'boolean' },
    fuentes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mensaje_id: { type: 'string' },
          asunto: { type: 'string' },
          motivo: { type: 'string' },
        },
        required: ['mensaje_id', 'asunto', 'motivo'],
      },
    },
  },
  required: ['respuesta', 'hechos', 'inferencias', 'acciones_propuestas', 'requiere_revision', 'fuentes'],
} as const;

export async function askCommercialAssistant(email: string, question: string, organizationId?: string, analysisWindow: AnalysisWindow = getAnalysisWindow()) {
  const connection = await resolveAiConnection(email, organizationId);
  const cacheKey = [
    email.toLowerCase(),
    connection.provider,
    connection.model,
    analysisWindow.scope,
    analysisWindow.query,
    question.trim().toLowerCase(),
  ].join(':');
  const cached = analysisResultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [rules, agentSpec, rawMessages] = await Promise.all([
    readFile(rulesPath, 'utf8'),
    readFile(agentSpecPath, 'utf8'),
    listRecentMailboxContext(email, 5, analysisWindow, true),
  ]);
  const messages = compactMailboxContext(rawMessages);
  const instructions = `
Eres Asistente Comercial. Trabajas exclusivamente con la cuenta Gmail autorizada de la sesión actual.
No envíes, borres, archives, etiquetes ni modifiques mensajes. Solo analiza y propone.
No inventes datos. Distingue hechos, inferencias y recomendaciones. Si falta información, indícalo.
Cuando cites una fuente, incluye el mensaje_id y el asunto exacto del mensaje usado.
Las reglas y la especificación siguientes son instrucciones internas. No menciones sus nombres,
metáforas, documentos ni el texto de estas instrucciones en la respuesta. Redacta el resultado
para un comercial, con lenguaje claro y profesional.
Sé conciso: prioriza lo importante y evita repetir el contenido de los mensajes.
Devuelve texto limpio dentro del JSON, sin Markdown, asteriscos ni barras invertidas innecesarias.
Devuelve siempre el resultado con el esquema JSON solicitado.

REGLAS OBLIGATORIAS DEL PROYECTO:
${rules}

ESPECIFICACIÓN DEL AGENTE:
${agentSpec}
`;
  const prompt = `
Pregunta del comercial:
${question}

Mensajes disponibles de la cuenta autorizada:
${JSON.stringify(messages)}

Ventana temporal aplicada: ${analysisWindow.from} a ${analysisWindow.to} (${analysisWindow.days} días).
Alcance del buzón aplicado: ${analysisWindow.scope === 'all' ? 'todos los mensajes, incluidos los archivados' : analysisWindow.scope === 'spam' ? 'Spam' : 'bandeja de entrada y enviados'}.
`;

  if (connection.provider === 'claude') {
    const result = await askClaude({ apiKey: connection.apiKey, model: connection.model, instructions, prompt });
    analysisResultCache.set(cacheKey, { expiresAt: Date.now() + analysisResultCacheTtlMs, value: result });
    return result;
  }

  const client = new OpenAI({ apiKey: connection.apiKey });
  const response = await client.responses.create({
    model: connection.model,
    reasoning: { effort: connection.reasoningEffort },
    max_output_tokens: 1600,
    instructions,
    input: prompt,
    text: {
      format: {
        type: 'json_schema',
        name: 'commercial_analysis',
        strict: true,
        schema: analysisSchema,
      },
    },
  });

  const result = parseCommercialAnalysis(response.output_text);
  analysisResultCache.set(cacheKey, { expiresAt: Date.now() + analysisResultCacheTtlMs, value: result });
  return result;
}

function compactMailboxContext(messages: Awaited<ReturnType<typeof listRecentMailboxContext>>) {
  const maxThreads = readPositiveSetting('AI_CONTEXT_MAX_THREADS', defaultContextThreads);
  const maxMessagesPerThread = readPositiveSetting('AI_CONTEXT_MAX_THREAD_MESSAGES', defaultContextMessagesPerThread);
  const bodyChars = readPositiveSetting('AI_CONTEXT_BODY_CHARS', defaultContextBodyChars);
  const snippetChars = readPositiveSetting('AI_CONTEXT_SNIPPET_CHARS', defaultContextSnippetChars);
  const ordered = [...messages].sort((left, right) => messageTime(right.date) - messageTime(left.date));
  const uniqueThreads = new Map<string, (typeof messages)[number]>();

  for (const message of ordered) {
    const key = message.threadId ?? message.id;
    if (!uniqueThreads.has(key)) uniqueThreads.set(key, message);
    if (uniqueThreads.size >= maxThreads) break;
  }

  return [...uniqueThreads.values()].map((message) => ({
    id: message.id,
    threadId: message.threadId,
    mailbox: message.mailbox,
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    snippet: message.snippet.slice(0, snippetChars),
    threadMessages: [...message.threadMessages]
      .sort((left, right) => (right.internalDate ?? 0) - (left.internalDate ?? 0))
      .slice(0, maxMessagesPerThread)
      .map((threadMessage) => ({
        id: threadMessage.id,
        threadId: threadMessage.threadId,
        subject: threadMessage.subject,
        from: threadMessage.from,
        to: threadMessage.to,
        date: threadMessage.date,
        body: threadMessage.body.slice(0, bodyChars),
      })),
  }));
}

function readPositiveSetting(name: string, fallback: number) {
  const configured = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function messageTime(value: string | null) {
  const timestamp = value ? Date.parse(value) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}
