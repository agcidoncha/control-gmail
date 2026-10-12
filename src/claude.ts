type ClaudeTextBlock = {
  type?: string;
  text?: string;
};

type ClaudeResponse = {
  content?: ClaudeTextBlock[];
  error?: { message?: string };
};

export type CommercialAnalysis = {
  respuesta: string;
  hechos: string[];
  inferencias: string[];
  acciones_propuestas: string[];
  requiere_revision: boolean;
  fuentes: Array<{ mensaje_id: string; asunto: string; motivo: string }>;
};

export async function askClaude(input: {
  apiKey: string;
  model: string;
  instructions: string;
  prompt: string;
}) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: 1600,
      system: input.instructions,
      messages: [{ role: 'user', content: input.prompt }],
    }),
  });

  const payload = await response.json() as ClaudeResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Claude devolvió HTTP ${response.status}.`);
  }

  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude no devolvió contenido para el análisis.');

  return parseCommercialAnalysis(text);
}

export function parseCommercialAnalysis(text: string): CommercialAnalysis {
  const cleaned = extractJson(text);
  try {
    const parsed = JSON.parse(cleaned) as Partial<CommercialAnalysis>;
    if (parsed && typeof parsed === 'object' && typeof parsed.respuesta === 'string') {
      const nested = parseNestedAnalysis(parsed.respuesta);
      return normalizeAnalysis(nested ?? parsed);
    }
  } catch {
    // Algunos proveedores pueden devolver texto plano pese a las instrucciones de formato.
  }

  return {
    respuesta: cleanPlainText(text),
    hechos: [],
    inferencias: [],
    acciones_propuestas: [],
    requiere_revision: true,
    fuentes: [],
  };
}

function normalizeAnalysis(parsed: Partial<CommercialAnalysis>): CommercialAnalysis {
  return {
    respuesta: cleanPlainText(parsed.respuesta ?? ''),
    hechos: cleanStringList(parsed.hechos),
    inferencias: cleanStringList(parsed.inferencias),
    acciones_propuestas: cleanStringList(parsed.acciones_propuestas),
    requiere_revision: parsed.requiere_revision !== false,
    fuentes: Array.isArray(parsed.fuentes)
      ? parsed.fuentes.filter(isAnalysisSource).map((source) => ({
        mensaje_id: source.mensaje_id,
        asunto: cleanPlainText(source.asunto),
        motivo: cleanPlainText(source.motivo),
      }))
      : [],
  };
}

function cleanStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(cleanPlainText)
    : [];
}

function parseNestedAnalysis(value: string): Partial<CommercialAnalysis> | null {
  const candidate = value.trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(candidate) as Partial<CommercialAnalysis>;
    return parsed && typeof parsed === 'object' && typeof parsed.respuesta === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function cleanPlainText(value: string) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/__([\s\S]*?)__/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isAnalysisSource(value: unknown): value is { mensaje_id: string; asunto: string; motivo: string } {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return typeof source.mensaje_id === 'string'
    && typeof source.asunto === 'string'
    && typeof source.motivo === 'string';
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? text).trim();
}
