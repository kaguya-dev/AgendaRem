export type LlmProviderKind = 'gemini' | 'compatible' | 'local';

export interface PublicLlmProvider {
  id: string;
  name: string;
  kind: LlmProviderKind;
  model: string;
  apiUrl: string;
  priority: number;
  enabled: boolean;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  keySet: boolean;
  requestsToday: number;
  tokensToday: number;
  reportedTokensToday: number;
  estimatedTokensToday: number;
  legacyTokensToday: number;
  unconfirmedRequestsToday: number;
  cooldownUntil: string | null;
  lastError: string | null;
}

export type SaveLlmProviderInput = Pick<
  PublicLlmProvider,
  | 'name'
  | 'kind'
  | 'model'
  | 'apiUrl'
  | 'priority'
  | 'enabled'
  | 'dailyRequestLimit'
  | 'dailyTokenLimit'
> & { id?: string; apiKey?: string };
