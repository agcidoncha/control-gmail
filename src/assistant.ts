import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { getAnalysisWindow, listClientAnalysisContext, listRecentMailboxContext, type AnalysisWindow } from './google-oauth.js';
import { resolveAiConnection } from './ai-connections.js';
import { askClaude, parseCommercialAnalysis, validateAnalysisSources, type CommercialAnalysis } from './claude.js';

const rulesPath = resolve('docs/reglas-seguridad-trabajo-con-ia.md');
const agentSpecPath = resolve('docs/agente-asistente-comercial-openai.md');
const analysisResultCache = new Map<string, { expiresAt: number; value: CommercialAnalysis; messageCount: number }>();
const analysisResultCacheTtlMs = 10 * 60 * 1000;
const defaultContextThreads = 12;
const defaultContextMessagesPerThread = 3;
const defaultContextBodyChars = 1200;
const defaultContextSnippetChars = 500;

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mensajes_analizados: { type: 'integer', minimum: 0 },
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
  required: ['mensajes_analizados', 'respuesta', 'hechos', 'inferencias', 'acciones_propuestas', 'requiere_revision', 'fuentes'],
} as const;

export async function askCommercialAssistant(email: string, question: string, organizationId?: string, analysisWindow: AnalysisWindow = getAnalysisWindow(), clientEmail?: string) {
  const connection = await resolveAiConnection(email, organizationId);
  const cacheKey = [
    email.toLowerCase(),
    connection.provider,
    connection.model,
    analysisWindow.scope,
    analysisWindow.query,
    clientEmail?.trim().toLowerCase() ?? 'all-clients',
    question.trim().toLowerCase(),
  ].join(':');
  const cached = analysisResultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { analysis: cached.value, messageCount: cached.messageCount };

  const [rules, agentSpec, rawMessages] = await Promise.all([
    readFile(rulesPath, 'utf8'),
    readFile(agentSpecPath, 'utf8'),
    clientEmail
      ? listClientAnalysisContext(email, clientEmail, analysisWindow)
      : listRecentMailboxContext(email, 5, analysisWindow, true),
  ]);
  const messages = compactMailboxContext(rawMessages);
  const exactMessageCount = messages.reduce((total, thread) => total + thread.threadMessages.length, 0);
  const sourceMessages = messages.flatMap((thread) => thread.threadMessages);
  const instructions = `
Eres Asistente Comercial. Trabajas exclusivamente con la cuenta Gmail autorizada de la sesión actual.
No envíes, borres, archives, etiquetes ni modifiques mensajes. Solo analiza y propone.
No inventes datos. Distingue hechos, inferencias y recomendaciones. Si falta información, indícalo.
La única cuenta cuya identidad está confirmada es ${email}. No deduzcas que otra dirección pertenece
a la misma persona por compartir un nombre, apellido o dominio. Si el texto no lo confirma, esa
posibilidad solo puede aparecer como inferencia, nunca como hecho ni como motivo para descartar trabajo.
Cuando cites una fuente, conserva el mensaje_id y el asunto exacto en el campo fuentes del JSON.
Para conclusiones sobre acuerdos o pendientes, incluye fuentes con el id real del mensaje de origen
y explica brevemente qué respalda cada una. No inventes identificadores ni dejes sin respaldo esas
conclusiones. Si el contexto no permite fundamentarlas, dilo expresamente.
No muestres identificadores técnicos, message_id, nombres de variables ni detalles de implementación
en respuesta, hechos, inferencias o acciones_propuestas. Si detectas mensajes de prueba o internos,
descríbelos de forma comprensible como mensajes internos o mensajes de prueba.
Las reglas y la especificación siguientes son instrucciones internas. No menciones sus nombres,
metáforas, documentos ni el texto de estas instrucciones en la respuesta. Redacta el resultado
para un comercial, con lenguaje claro y profesional.
Sé conciso: prioriza lo importante y evita repetir el contenido de los mensajes.
Devuelve texto limpio dentro del JSON, sin Markdown, asteriscos ni barras invertidas innecesarias.
El campo mensajes_analizados debe ser exactamente ${exactMessageCount}. No escribas ninguna otra cifra
de recuento de mensajes en la respuesta.
Devuelve exclusivamente un objeto JSON válido, no texto libre ni bloques Markdown. Este esquema es
obligatorio aunque los documentos siguientes describan la salida como recomendada:
${JSON.stringify(analysisSchema)}

REGLAS OBLIGATORIAS DEL PROYECTO:
${rules}

ESPECIFICACIÓN DEL AGENTE:
${agentSpec}
`;
  const prompt = `
Pregunta del comercial:
${question}

${clientEmail ? `Cliente seleccionado: ${clientEmail}\nAnaliza exclusivamente los mensajes de este cliente. No mezcles conversaciones de otros remitentes ni atribuyas sus necesidades a otra persona.` : 'No se ha seleccionado un cliente concreto; trabaja con el conjunto de mensajes disponible y no inventes clientes.'}

Mensajes disponibles de la cuenta autorizada:
${JSON.stringify(messages)}

Control de cantidades: la aplicación ha enviado exactamente ${exactMessageCount} mensaje(s) en este contexto. Si mencionas una cantidad, usa exclusivamente este número. No cuentes hilos, asuntos, fuentes, fragmentos ni mensajes repetidos como mensajes adicionales. Si el contexto es insuficiente, dilo claramente y no extrapoles.

Ventana temporal aplicada: ${analysisWindow.from} a ${analysisWindow.to} (${analysisWindow.days} días).
Alcance del buzón aplicado: ${analysisWindow.scope === 'all' ? 'todos los mensajes, incluidos los archivados' : analysisWindow.scope === 'spam' ? 'Spam' : 'bandeja de entrada y enviados'}.
`;

  if (connection.provider === 'claude') {
    const result = validateAnalysisSources(validateMessageCount(sanitizeCommercialAnalysis(await askClaude({ apiKey: connection.apiKey, model: connection.model, instructions, prompt })), exactMessageCount), sourceMessages);
    analysisResultCache.set(cacheKey, { expiresAt: Date.now() + analysisResultCacheTtlMs, value: result, messageCount: exactMessageCount });
    return { analysis: result, messageCount: exactMessageCount };
  }

  const client = new OpenAI({
    apiKey: connection.apiKey,
    ...(connection.provider === 'deepseek' ? { baseURL: 'https://api.deepseek.com' } : {}),
  });
  const response = await client.responses.create({
    model: connection.model,
    ...(connection.provider === 'openai' ? { reasoning: { effort: connection.reasoningEffort } } : {}),
    max_output_tokens: connection.provider === 'deepseek' ? 2800 : 1600,
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

  const result = validateAnalysisSources(validateMessageCount(sanitizeCommercialAnalysis(parseCommercialAnalysis(response.output_text)), exactMessageCount), sourceMessages);
  analysisResultCache.set(cacheKey, { expiresAt: Date.now() + analysisResultCacheTtlMs, value: result, messageCount: exactMessageCount });
  return { analysis: result, messageCount: exactMessageCount };
}

function sanitizeCommercialAnalysis(result: CommercialAnalysis): CommercialAnalysis {
  const clean = (value: string) => value
    .replace(/\(?\b(?:mensaje_id|message_id)\b\s*[:=]?\s*[A-Za-z0-9_-]+\)?/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return {
    ...result,
    respuesta: clean(result.respuesta),
    hechos: result.hechos.map(clean),
    inferencias: result.inferencias.map(clean),
    acciones_propuestas: result.acciones_propuestas.map(clean),
  };
}

function validateMessageCount(result: CommercialAnalysis, exactMessageCount: number): CommercialAnalysis {
  // The application count is authoritative. Some providers, especially Claude,
  // may omit the self-reported field even when the rest of the JSON is valid.
  // In that case we fill the trusted count from the context sent by the server.
  if (result.mensajes_analizados === null) {
    return { ...result, mensajes_analizados: exactMessageCount };
  }
  if (result.mensajes_analizados === exactMessageCount) return result;
  return {
    ...result,
    requiere_revision: true,
    respuesta: `El recuento de mensajes declarado por el modelo no coincide con el control de la aplicación. Se enviaron exactamente ${exactMessageCount} mensajes a este análisis, por lo que el resultado requiere revisión humana antes de tomar decisiones.\n\n${result.respuesta}`,
    acciones_propuestas: [
      'Revisar el resultado antes de registrar decisiones, compromisos o seguimientos.',
      ...result.acciones_propuestas,
    ],
  };
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
