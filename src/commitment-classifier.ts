import OpenAI from 'openai';
import { resolveAiConnection, type AiProvider } from './ai-connections.js';
import type { GmailThreadMessage } from './google-oauth.js';

export type CommitmentDecision = {
  isCommitment: boolean;
  confidence: number;
  reason: string;
  requiresReview: boolean;
  source: 'ai' | 'unavailable';
};

type CacheEntry = { expiresAt: number; value: CommitmentDecision };

const decisionCache = new Map<string, CacheEntry>();
const decisionRequests = new Map<string, Promise<CommitmentDecision>>();
const decisionCacheTtlMs = 24 * 60 * 60 * 1000;

/**
 * Confirma con IA si una señal encontrada por las reglas representa realmente
 * un compromiso. Si la conexión no está disponible, conserva el candidato y
 * lo marca para revisión: una caída del proveedor nunca debe ocultar trabajo.
 */
export async function classifyCommitmentWithAi(email: string, thread: GmailThreadMessage[], candidate: string): Promise<CommitmentDecision> {
  const connection = await resolveOptionalConnection(email);
  if (!connection) return unavailableDecision();

  // Compromisos respeta siempre el modelo efectivo de la conexión activa:
  // global, asignado al comercial o personal. No sustituimos la configuración
  // por un modelo económico de forma silenciosa.
  const model = connection.model;
  const lastMessage = thread.at(-1);
  const cacheKey = [email.toLowerCase(), connection.provider, model, lastMessage?.threadId ?? '', lastMessage?.date ?? '', candidate.toLowerCase()].join(':');
  const cached = decisionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const existing = decisionRequests.get(cacheKey);
  if (existing) return existing;

  const request = requestDecision(connection.provider, connection.apiKey, model, thread, candidate);
  decisionRequests.set(cacheKey, request);
  try {
    const result = await request;
    if (result.source === 'ai') decisionCache.set(cacheKey, { expiresAt: Date.now() + decisionCacheTtlMs, value: result });
    return result;
  } finally {
    decisionRequests.delete(cacheKey);
  }
}

async function resolveOptionalConnection(email: string) {
  try {
    return await resolveAiConnection(email);
  } catch {
    return null;
  }
}

async function requestDecision(provider: AiProvider, apiKey: string, model: string, thread: GmailThreadMessage[], candidate: string): Promise<CommitmentDecision> {
  const context = thread.map((message) => ({
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    body: message.body.slice(0, 2600),
  }));
  const instructions = 'Analiza un posible compromiso en un hilo de correo comercial. Devuelve exclusivamente un objeto JSON válido con exactamente estas propiedades: {"is_commitment": boolean, "confidence": número entre 0 y 1, "reason": "explicación breve, máximo 180 caracteres"}. Los nombres de propiedades deben ser esos, no los traduzcas ni añadas texto fuera del JSON. Solo considera compromiso si el contexto indica una tarea, promesa, confirmación, fecha, plazo o respuesta que alguien debe realizar. No confundas una petición informativa, una negación o un mensaje automático con un compromiso. Si no estás seguro, usa is_commitment=false y confidence bajo. No inventes datos.';
  const prompt = `Posible frase candidata:\n${candidate}\n\nHilo completo disponible:\n${JSON.stringify(context)}\n\nDevuelve si la frase representa un compromiso real y explica brevemente por qué.`;

  try {
    const raw = provider === 'claude'
      ? await requestClaude(apiKey, model, instructions, prompt)
      : await requestOpenAi(provider, apiKey, model, instructions, prompt);
    return normalizeCommitmentDecision(raw, candidate);
  } catch {
    return unavailableDecision();
  }
}

async function requestOpenAi(provider: AiProvider, apiKey: string, model: string, instructions: string, prompt: string) {
  const client = new OpenAI({
    apiKey,
    timeout: 20_000,
    maxRetries: 0,
    ...(provider === 'deepseek' ? { baseURL: 'https://api.deepseek.com' } : {}),
  });
  if (provider === 'deepseek') {
    const response = await client.chat.completions.create({
      model,
      max_tokens: 220,
      response_format: { type: 'json_object' },
      // Estas clasificaciones son deliberadamente cortas. El razonamiento
      // activado consume el límite antes de que DeepSeek emita el JSON.
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt },
      ],
    } as never);
    return response.choices[0]?.message?.content ?? '';
  }
  const response = await client.responses.create({
    model,
    // Los modelos de razonamiento pueden consumir parte del límite antes de
    // emitir el JSON. Dejamos margen para que la clasificación no se corte.
    max_output_tokens: 600,
    instructions,
    input: prompt,
    text: {
      format: {
        type: 'json_schema',
        name: 'commitment_classification',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            is_commitment: { type: 'boolean' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            reason: { type: 'string' },
          },
          required: ['is_commitment', 'confidence', 'reason'],
        },
      },
    },
  });
  return response.output_text;
}

async function requestClaude(apiKey: string, model: string, instructions: string, prompt: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 220,
      system: instructions,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Claude devolvió HTTP ${response.status}.`);
  return (payload.content ?? []).filter((block) => block.type === 'text').map((block) => block.text || '').join('\n');
}

export function normalizeCommitmentDecision(value: string, candidate = ''): CommitmentDecision {
  try {
    const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as Partial<{ is_commitment: boolean; confidence: number; reason: string }> | null;
    if (!parsed || typeof parsed.is_commitment !== 'boolean' || typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence) || typeof parsed.reason !== 'string' || !parsed.reason.trim()) return unavailableDecision();
    const confidence = typeof parsed.confidence === 'number' ? Math.min(Math.max(parsed.confidence, 0), 1) : 0;
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'El contexto requiere revisión humana.';
    const explicitSignal = /\bquedo\s+a\s+la\s+espera\b|\bconf[ií]rmame\b|\bte\s+enviar(?:é|e|emos)(?![\p{L}\p{N}_])|\bnecesit(?:o|amos)\s+que\b|\bplease\s+confirm\b|\bwaiting\s+for\b/iu.test(candidate);
    const uncertain = confidence < 0.65;
    // La regla de extracción ya ha encontrado una petición explícita de
    // confirmación o respuesta. La IA puede discrepar sobre si llamarlo
    // «compromiso», pero no debemos ocultar esa señal: se conserva y, si la
    // discrepancia es clara, se deriva a revisión humana.
    const clearCommitment = explicitSignal;
    const modelDisagrees = explicitSignal && parsed.is_commitment === false;
    return {
      isCommitment: parsed.is_commitment === true || clearCommitment || uncertain,
      confidence,
      reason,
      requiresReview: modelDisagrees || uncertain,
      source: 'ai',
    };
  } catch {
    return unavailableDecision();
  }
}

function unavailableDecision(): CommitmentDecision {
  return {
    isCommitment: true,
    confidence: 0,
    reason: 'No se pudo validar con el modelo activo.',
    requiresReview: true,
    source: 'unavailable',
  };
}
