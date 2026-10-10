import { defaultOrganizationId, getOrganization } from './organization-store.js';
import { loadPersonalAiConnection } from './ai-connection-store.js';
import { getUser } from './user-store.js';

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
 * La conexión personal tiene prioridad. La conexión compartida solo se puede
 * usar si el usuario es administrador o la organización se la ha concedido.
 */
export async function resolveAiConnection(userEmail: string, organizationId = defaultOrganizationId): Promise<ResolvedAiConnection> {
  const personal = await loadPersonalAiConnection(organizationId, userEmail);
  if (personal) {
    return {
      organizationId,
      userEmail,
      provider: personal.provider,
      mode: 'user_personal',
      status: 'active',
      apiKey: personal.apiKey,
      model: personal.provider === 'openai'
        ? (process.env.OPENAI_MODEL ?? 'gpt-6-luna')
        : (process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'),
      reasoningEffort: (process.env.OPENAI_REASONING_EFFORT ?? 'high') as 'low' | 'medium' | 'high',
    };
  }

  const user = await getUser(userEmail);
  const organization = await getOrganization(organizationId);
  const sharedAllowed = user?.role === 'admin'
    || Boolean(organization?.sharedAiUserEmails?.includes(userEmail.toLowerCase()));
  if (!sharedAllowed) {
    throw new Error('No tienes una conexión de IA disponible. Conecta una clave personal o solicita al administrador acceso a la conexión global.');
  }

  const provider = (organization?.sharedAiProvider ?? process.env.DEFAULT_AI_PROVIDER ?? 'openai').toLowerCase();
  const normalizedProvider = provider === 'claude' ? 'claude' : 'openai';
  const apiKey = normalizedProvider === 'claude' ? process.env.CLAUDE_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(normalizedProvider === 'claude' ? 'Falta CLAUDE_API_KEY en .env.' : 'Falta OPENAI_API_KEY en .env.');

  return {
    organizationId,
    userEmail,
    provider: normalizedProvider,
    mode: 'company_shared',
    status: 'active',
    apiKey,
    model: normalizedProvider === 'claude' ? (process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6') : (process.env.OPENAI_MODEL ?? 'gpt-6-luna'),
    reasoningEffort: (process.env.OPENAI_REASONING_EFFORT ?? 'high') as 'low' | 'medium' | 'high',
  };
}
