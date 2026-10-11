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
      max_tokens: 4096,
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
      return {
        respuesta: parsed.respuesta,
        hechos: Array.isArray(parsed.hechos) ? parsed.hechos.filter((item): item is string => typeof item === 'string') : [],
        inferencias: Array.isArray(parsed.inferencias) ? parsed.inferencias.filter((item): item is string => typeof item === 'string') : [],
        acciones_propuestas: Array.isArray(parsed.acciones_propuestas) ? parsed.acciones_propuestas.filter((item): item is string => typeof item === 'string') : [],
        requiere_revision: parsed.requiere_revision !== false,
        fuentes: Array.isArray(parsed.fuentes) ? parsed.fuentes.filter(isAnalysisSource) : [],
      };
    }
  } catch {
    // Algunos proveedores pueden devolver texto plano pese a las instrucciones de formato.
  }

  return {
    respuesta: text.trim(),
    hechos: [],
    inferencias: [],
    acciones_propuestas: [],
    requiere_revision: true,
    fuentes: [],
  };
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
