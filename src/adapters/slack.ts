import type { TerminalState } from "../types.js";

export interface SlackMessageInput {
  targetKind: "issue" | "pr";
  targetNumber: number;
  issueTitle?: string;
  repo: string;
  finalState: TerminalState;
  elapsedMs: number;
  prNumber?: number;
}

export interface SlackNotifierConfig {
  webhookUrl?: string;
  botToken?: string;
  channel?: string;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatSlackMessage(input: SlackMessageInput): string {
  const iconMap = { done: ":white_check_mark:", failed: ":x:", blocked: ":warning:", manual_handoff: ":raised_hand:" } as const;
  const statusMap = { done: "completed", failed: "failed", blocked: "blocked", manual_handoff: "handed off" } as const;
  const icon = iconMap[input.finalState];
  const status = statusMap[input.finalState];
  const targetLabel = input.targetKind === "pr" ? "PR" : "Issue";
  const title = input.issueTitle ?? `${targetLabel} #${input.targetNumber}`;
  const elapsed = formatElapsed(input.elapsedMs);

  let msg = `${icon} *aidev* ${status}: ${title} (${targetLabel} #${input.targetNumber}) in \`${input.repo}\`\nElapsed: ${elapsed}`;

  if (input.prNumber) {
    msg += `\nPR #${input.prNumber}`;
  }

  return msg;
}

export function createSlackNotifier(
  config: SlackNotifierConfig
): (message: string) => Promise<void> {
  const hasWebhook = !!config.webhookUrl;
  const hasBot = !!config.botToken && !!config.channel;

  if (!hasWebhook && !hasBot) {
    return async () => {};
  }

  return async (message: string) => {
    const promises: Promise<void>[] = [];

    if (hasWebhook) {
      promises.push(
        fetch(config.webhookUrl!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        }).then(() => {})
      );
    }

    if (hasBot) {
      promises.push(
        fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.botToken}`,
          },
          body: JSON.stringify({ channel: config.channel, text: message }),
        }).then(() => {})
      );
    }

    try {
      await Promise.all(promises);
    } catch {
      // Non-fatal: notification failure should not affect workflow
    }
  };
}
