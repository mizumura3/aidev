import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import type {
  HookCallback,
  HookCallbackMatcher,
  Options,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-code";

const DANGEROUS_BASH_PATTERNS = [
  /\bgit\s+push\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgh\s+pr\s+merge\b/,
  /\bgh\s+issue\s+close\b/,
  /\brm\s+-rf\s+\//,
  /\bsudo\b/,
];

const SECRET_FILE_PATTERNS = [/\.env$/, /\.pem$/, /id_rsa/, /\.key$/];

export async function blockDangerousOps(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<SyncHookJSONOutput> {
  if (toolName === "Bash") {
    const command = String(toolInput.command ?? "");
    for (const pattern of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(command)) {
        return {
          decision: "block",
          reason: `Blocked dangerous command: ${command}`,
        };
      }
    }
  }

  if (toolName === "Read" || toolName === "Edit" || toolName === "Write") {
    const filePath = String(toolInput.file_path ?? "");
    for (const pattern of SECRET_FILE_PATTERNS) {
      if (pattern.test(filePath)) {
        return {
          decision: "block",
          reason: `Blocked access to sensitive file: ${filePath}`,
        };
      }
    }
  }

  return {};
}

export function createSafetyHook(): HookCallbackMatcher {
  const hook: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    return blockDangerousOps(
      input.tool_name,
      input.tool_input as Record<string, unknown>
    );
  };
  return { hooks: [hook] };
}

/** 入れ子判定を回避するために削除する環境変数 */
const NESTED_DETECTION_VARS = ["CLAUDECODE"];

export function cleanEnvForSdk(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (NESTED_DETECTION_VARS.includes(key)) continue;
    env[key] = value;
  }
  // SDK として起動することを明示
  env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
  return env;
}

export function findClaudeExecutable(): string | undefined {
  if (process.env.CLAUDE_EXECUTABLE) return process.env.CLAUDE_EXECUTABLE;

  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    if (dir.includes("node_modules")) continue;
    const candidate = join(dir, "claude");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function extractJson(text: string, agentName: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`${agentName} did not return JSON. Response: ${text.slice(0, 500)}`);
  }
  return JSON.parse(match[0]);
}

export function getBaseSdkOptions(): Pick<Options, "pathToClaudeCodeExecutable" | "env"> {
  const executable = findClaudeExecutable();
  if (!executable) {
    throw new Error(
      "Native Claude Code binary not found. " +
      "Install: https://docs.anthropic.com/en/docs/claude-code or " +
      "set --claude-path / CLAUDE_EXECUTABLE"
    );
  }
  return {
    pathToClaudeCodeExecutable: executable,
    env: cleanEnvForSdk(),
  };
}
