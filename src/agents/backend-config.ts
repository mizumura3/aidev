export interface BackendConfig {
  backend: string;
  model?: string;
  /** API key for backends that require it (e.g. codex-sdk needs OPENAI_API_KEY) */
  apiKey?: string;
}

export const DEFAULT_BACKEND = "claude-code";
