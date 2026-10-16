import OpenAI from 'openai';
import { resolveAiConnection, type AiProvider } from './ai-connections.js';
import type { GmailThreadMessage } from './google-oauth.js';

export const followUpCategories = [
  'Posible presupuesto',
  'Posible propuesta',
  'Briefing pendiente',
  'Solicitud de información',
  'Seguimiento general',
  'Revisión humana',
] as const;

export type FollowUpCategory = typeof followUpCategories[number];

type Classification = { category: FollowUpCategory; confidence: number };
type CacheEntry = { expiresAt: number; value: Classification };

const classificationCache = new Map<string, CacheEntry>();
const classificationRequests = new Map<string, Promise<Classification>>();
const classificationCacheTtlMs = 24 * 60 * 60 * 1000;

/** Clasificación rápida y transparente para los casos que contienen señales claras. */
export function classifyFollowUpByRules(thread: GmailThreadMessage[]): FollowUpCategory | null {
  const content = thread.map((message) => `${message.subject}\n${message.body}`).join('\n').toLowerCase();
  if (/\bbriefing\b|\bbrief\b/.test(content)) return 'Briefing pendiente';
  if (/\bpresupuesto(?:s)?\b|\bcotizaci[oó]n(?:es)?\b|\bquotation(?:s)?\b|\bquote(?:s)?\b|\bpricing\b|\bprecio(?:s)?\b|\bcoste(?:s)?\b|\bcosto(?:s)?\b|\btarifa(?:s)?\b|\bpropuesta\s+econ[oó]mica\b/.test(content)) return 'Posible presupuesto';
  if (/\bpropuesta(?:s)?\b|\boferta(?:s)?\b|\bproposal(?:s)?\b/.test(content)) return 'Posible propuesta';
  if (/\bbriefing\b|\binformaci[oó]n\b|\bdetalles?\b|\bconfirm(?:ar|aci[oó]n)\b|\bdatos\b|\balcance\b/.test(content)) return 'Solicitud de información';
  return null;
}

/**
 * Solo usa IA cuando las reglas no encuentran una señal clara. El modelo se
 * fuerza a una opción económica por proveedor para que esta clasificación no
 * consuma el modelo avanzado elegido para consultas complejas.
 */
export async function classifyFollowUpWithAi(email: string, thread: GmailThreadMessage[]): Promise<FollowUpCategory> {
  const connection = await resolveOptionalConnection(email);
  if (!connection) return 'Revisión humana';

  const model = classifierModel(connection.provider);
  const lastMessage = thread.at(-1);
  const cacheKey = [email.toLowerCase(), connection.provider, model, lastMessage?.threadId ?? '', lastMessage?.date ?? ''].join(':');
  const cached = classificationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value.category;
  const existing = classificationRequests.get(cacheKey);
  if (existing) return (await existing).category;

  const request = requestClassification(connection.provider, connection.apiKey, model, thread);
  classificationRequests.set(cacheKey, request);
  try {
    const result = await request;
    if (result.confidence > 0) classificationCache.set(cacheKey, { expiresAt: Date.now() + classificationCacheTtlMs, value: result });
    return result.category;
  } finally {
    classificationRequests.delete(cacheKey);
  }
}

async function resolveOptionalConnection(email: string) {
  try {
    return await resolveAiConnection(email);
  } catch {
    return null;
  }
}

function classifierModel(provider: AiProvider) {
  return process.env.FOLLOW_UP_CLASSIFIER_MODEL?.trim() || {
    openai: 'gpt-6-luna',
    claude: 'claude-haiku-4-5',
    deepseek: 'deepseek-flash',
  }[provider];
}

async function requestClassification(provider: AiProvider, apiKey: string, model: string, thread: GmailThreadMessage[]): Promise<Classification> {
  const context = thread.map((message) => ({
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    body: message.body.slice(0, 2200),
  }));
  const instructions = `Clasifica un hilo de seguimiento comercial. Devuelve exclusivamente JSON válido con las propiedades category y confidence. category debe ser exactamente una de: ${followUpCategories.join(', ')}. Usa Revisión humana si el significado no es suficientemente claro. confidence debe ser un número entre 0 y 1. No inventes información.`;
  const prompt = `Hilo de correo:\n${JSON.stringify(context)}\n\nEl último mensaje fue enviado por el comercial y no tiene respuesta posterior. Clasifica la intención principal del seguimiento.`;

  try {
    const raw = provider === 'claude'
      ? await requestClaude(apiKey, model, instructions, prompt)
      : await requestOpenAi(provider, apiKey, model, instructions, prompt);
    return normalizeClassification(raw);
  } catch {
    return { category: 'Revisión humana', confidence: 0 };
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
      max_tokens: 180,
      response_format: { type: 'json_object' },
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
    max_output_tokens: 600,
    instructions,
    input: prompt,
    text: {
      format: {
        type: 'json_schema',
        name: 'follow_up_classification',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            category: { type: 'string', enum: [...followUpCategories] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['category', 'confidence'],
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
    body: JSON.stringify({ model, max_tokens: 120, system: instructions, messages: [{ role: 'user', content: prompt }] }),
  });
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Claude devolvió HTTP ${response.status}.`);
  return (payload.content ?? []).filter((block) => block.type === 'text').map((block) => block.text || '').join('\n');
}

function normalizeClassification(value: string): Classification {
  try {
    const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned) as Partial<Classification>;
    const category = followUpCategories.includes(parsed.category as FollowUpCategory) ? parsed.category as FollowUpCategory : 'Revisión humana';
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    return { category: confidence >= 0.65 ? category : 'Revisión humana', confidence };
  } catch {
    return { category: 'Revisión humana', confidence: 0 };
  }
}
