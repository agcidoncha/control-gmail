import { defaultOrganizationId } from './organization-store.js';

export type AiProvider = 'openai' | 'claude';
export type AiConnectionMode = 'company_shared' | 'user_personal';

export type AiConnectionPreference = {
  organizationId: string;
  userEmail?: string;
  provider: AiProvider;
  mode: AiConnectionMode;
  status: 'active' | 'not_configured' | 'disabled';
};

export type ResolvedAiConnection = AiConnectionPreference & {
  apiKey: string;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high';
};

/**
 * Resolución temporal de la conexión de IA. La primera empresa utiliza la
 * credencial compartida del entorno; las credenciales personales se añadirán
 * en una fase posterior mediante almacenamiento cifrado.
 */
export function resolveAiConnection(userEmail: string, organizationId = defaultOrganizationId): ResolvedAiConnection {
  const provider = (process.env.DEFAULT_AI_PROVIDER ?? 'openai').toLowerCase();
  if (provider !== 'openai') {
    throw new Error('El proveedor Claude está modelado, pero todavía no está conectado al asistente.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY en .env.');

  return {
    organizationId,
    userEmail,
    provider: 'openai',
    mode: 'company_shared',
    status: 'active',
    apiKey,
    model: process.env.OPENAI_MODEL ?? 'gpt-6-luna',
    reasoningEffort: (process.env.OPENAI_REASONING_EFFORT ?? 'high') as 'low' | 'medium' | 'high',
  };
}
