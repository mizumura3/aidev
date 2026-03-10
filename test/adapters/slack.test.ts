import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatSlackMessage,
  createSlackNotifier,
  type SlackMessageInput,
} from "../../src/adapters/slack.js";

describe("formatSlackMessage", () => {
  const baseInput: SlackMessageInput = {
    targetKind: "issue",
    targetNumber: 42,
    issueTitle: "Add feature X",
    repo: "owner/repo",
    finalState: "done",
    elapsedMs: 120_000,
  };

  it("formats a success message", () => {
    const msg = formatSlackMessage(baseInput);
    expect(msg).toContain("#42");
    expect(msg).toContain("Add feature X");
    expect(msg).toContain("owner/repo");
    expect(msg).toContain("2m 0s");
  });

  it("formats a failure message", () => {
    const msg = formatSlackMessage({ ...baseInput, finalState: "failed" });
    expect(msg).toContain("failed");
    expect(msg).toContain("#42");
  });

  it("includes PR link when prNumber is provided", () => {
    const msg = formatSlackMessage({ ...baseInput, prNumber: 99 });
    expect(msg).toContain("#99");
  });

  it("labels PR targets distinctly from issues", () => {
    const msg = formatSlackMessage({
      ...baseInput,
      targetKind: "pr",
      targetNumber: 7,
      issueTitle: "Improve existing PR",
    });
    expect(msg).toContain("PR #7");
    expect(msg).not.toContain("Issue #7");
  });

  it("omits PR link when prNumber is not provided", () => {
    const msg = formatSlackMessage(baseInput);
    expect(msg).not.toContain("PR #");
  });

  it("formats elapsed time in human-readable form", () => {
    expect(formatSlackMessage({ ...baseInput, elapsedMs: 65_000 })).toContain(
      "1m 5s"
    );
    expect(formatSlackMessage({ ...baseInput, elapsedMs: 3_661_000 })).toContain(
      "1h 1m"
    );
    expect(formatSlackMessage({ ...baseInput, elapsedMs: 45_000 })).toContain(
      "45s"
    );
  });

  it("uses issue number as title fallback", () => {
    const msg = formatSlackMessage({ ...baseInput, issueTitle: undefined });
    expect(msg).toContain("Issue #42");
  });

  it("formats a manual_handoff message with raised_hand icon", () => {
    const msg = formatSlackMessage({ ...baseInput, finalState: "manual_handoff" });
    expect(msg).toContain(":raised_hand:");
    expect(msg).toContain("handed off");
    expect(msg).toContain("#42");
  });
});

describe("createSlackNotifier", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends to webhook URL when configured", async () => {
    const notifier = createSlackNotifier({ webhookUrl: "https://hooks.slack.com/test" });
    await notifier("test message");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "test message" }),
      })
    );
  });

  it("sends via bot token when configured", async () => {
    const notifier = createSlackNotifier({
      botToken: "xoxb-test-token",
      channel: "C12345",
    });
    await notifier("test message");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-test-token",
        }),
        body: JSON.stringify({ channel: "C12345", text: "test message" }),
      })
    );
  });

  it("sends to both webhook and bot when both are configured", async () => {
    const notifier = createSlackNotifier({
      webhookUrl: "https://hooks.slack.com/test",
      botToken: "xoxb-test-token",
      channel: "C12345",
    });
    await notifier("test message");

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not throw on fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network error");
    });
    const notifier = createSlackNotifier({ webhookUrl: "https://hooks.slack.com/test" });

    // Should not throw
    await expect(notifier("test message")).resolves.toBeUndefined();
  });

  it("returns a no-op when no config is provided", async () => {
    const notifier = createSlackNotifier({});
    await notifier("test message");

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
