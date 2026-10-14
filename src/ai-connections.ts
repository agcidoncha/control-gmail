import { defaultOrganizationId, getOrganization } from './organization-store.js';
import { loadPersonalAiConnection } from './ai-connection-store.js';
import { getUser } from './user-store.js';
import { getAiApiKey, getDefaultAiModel, normalizeAiProvider } from './ai-models.js';

export type AiProvider = 'openai' | 'claude' | 'deepseek';
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
      model: personal.model ?? getDefaultAiModel(personal.provider),
      reasoningEffort: (process.env.OPENAI_REASONING_EFFORT ?? 'high') as 'low' | 'medium' | 'high',
    };
  }

  const user = await getUser(userEmail);
  const organization = await getOrganization(organizationId);
  const sharedAllowed = user?.role === 'admin'
    || user?.aiAccessEnabled === true
    || Boolean(organization?.sharedAiUserEmails?.includes(userEmail.toLowerCase()));
  if (!sharedAllowed) {
    throw new Error('No tienes una conexión de IA disponible. Conecta una clave personal o solicita al administrador acceso a la conexión global.');
  }

  // El administrador siempre utiliza la configuración global de la empresa.
  // Las asignaciones individuales solo aplican a usuarios comerciales.
  const assignedProvider = user?.role === 'admin' ? null : normalizeAiProvider(user?.aiProvider);
  const normalizedProvider = assignedProvider
    ?? normalizeAiProvider(organization?.sharedAiProvider ?? process.env.DEFAULT_AI_PROVIDER ?? 'openai')
    ?? 'openai';
  const apiKey = getAiApiKey(normalizedProvider);
  if (!apiKey) throw new Error(`Falta ${normalizedProvider.toUpperCase()}_API_KEY en .env.`);

  return {
    organizationId,
    userEmail,
    provider: normalizedProvider,
    mode: 'company_shared',
    status: 'active',
    apiKey,
    model: assignedProvider
      ? user?.aiModel ?? getDefaultAiModel(normalizedProvider)
      : organization?.sharedAiModel ?? getDefaultAiModel(normalizedProvider),
    reasoningEffort: (process.env.OPENAI_REASONING_EFFORT ?? 'high') as 'low' | 'medium' | 'high',
  };
}
