import type {
  HookCallback,
  HookCallbackMatcher,
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
