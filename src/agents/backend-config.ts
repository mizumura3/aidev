export interface BackendConfig {
  backend: string;
  model?: string;
  apiKey?: string;
}

export const DEFAULT_BACKEND = "claude-code";
