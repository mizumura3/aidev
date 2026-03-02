export interface SlackMessageInput {
  issueNumber: number;
  issueTitle?: string;
  repo: string;
  finalState: "done" | "failed";
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
  const icon = input.finalState === "done" ? ":white_check_mark:" : ":x:";
  const status = input.finalState === "done" ? "completed" : "failed";
  const title = input.issueTitle ?? `Issue #${input.issueNumber}`;
  const elapsed = formatElapsed(input.elapsedMs);

  let msg = `${icon} *aidev* ${status}: ${title} (#${input.issueNumber}) in \`${input.repo}\`\nElapsed: ${elapsed}`;

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
