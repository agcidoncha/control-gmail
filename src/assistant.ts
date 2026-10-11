import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import OpenAI from 'openai';
import { getAnalysisWindow, listRecentMailboxContext, type AnalysisWindow } from './google-oauth.js';
import { resolveAiConnection } from './ai-connections.js';
import { askClaude, parseCommercialAnalysis } from './claude.js';

const rulesPath = resolve('docs/reglas-seguridad-trabajo-con-ia.md');
const agentSpecPath = resolve('docs/agente-asistente-comercial-openai.md');

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
  const [rules, agentSpec, messages] = await Promise.all([
    readFile(rulesPath, 'utf8'),
    readFile(agentSpecPath, 'utf8'),
    listRecentMailboxContext(email, 5, analysisWindow, true),
  ]);

  const connection = await resolveAiConnection(email, organizationId);
  const instructions = `
Eres Asistente Comercial. Trabajas exclusivamente con la cuenta Gmail autorizada de la sesión actual.
No envíes, borres, archives, etiquetes ni modifiques mensajes. Solo analiza y propone.
No inventes datos. Distingue hechos, inferencias y recomendaciones. Si falta información, indícalo.
Cuando cites una fuente, incluye el mensaje_id y el asunto exacto del mensaje usado.
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
    return askClaude({ apiKey: connection.apiKey, model: connection.model, instructions, prompt });
  }

  const client = new OpenAI({ apiKey: connection.apiKey });
  const response = await client.responses.create({
    model: connection.model,
    reasoning: { effort: connection.reasoningEffort },
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

  return parseCommercialAnalysis(response.output_text);
}
