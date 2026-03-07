import type { Logger } from "../util/logger.js";

export interface ProgressEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentRunOptions {
  cwd: string;
  agentName: string;
  logger: Logger;
  allowedTools?: string[];
  maxTurns?: number;
  onMessage?: (message: ProgressEvent) => void;
}

export interface AgentRunner {
  run(prompt: string, options: AgentRunOptions): Promise<string>;
}
