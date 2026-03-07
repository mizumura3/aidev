import type { SDKMessage } from "@anthropic-ai/claude-code";
import type { Logger } from "../util/logger.js";

export type { SDKMessage };

export interface AgentRunOptions {
  cwd: string;
  agentName: string;
  logger: Logger;
  allowedTools?: string[];
  maxTurns?: number;
  onMessage?: (message: SDKMessage) => void;
}

export interface AgentRunner {
  run(prompt: string, options: AgentRunOptions): Promise<string>;
}
