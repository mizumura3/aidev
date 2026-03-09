import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/adapters/git.js", () => ({
  createGitAdapter: vi.fn(() => ({})),
}));

vi.mock("../src/adapters/github.js", () => ({
  createGitHubAdapter: vi.fn(() => ({})),
}));

vi.mock("../src/workflow/states.js", () => ({
  createStateHandlers: vi.fn(() => ({})),
}));

vi.mock("../src/workflow/engine.js", () => ({
  runWorkflow: vi.fn(),
}));

vi.mock("../src/preflight.js", () => ({
  runPreflightChecks: vi.fn(async () => {}),
}));

vi.mock("../src/agents/runner-factory.js", () => ({
  createRunner: vi.fn(() => ({
    run: vi.fn(async () => "mock result"),
  })),
}));

import { createCli } from "../src/cli.js";

class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("--repo required validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitError(code as number);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("run command exits with error when --repo is not specified", async () => {
    const cli = createCli();

    await expect(
      cli.parseAsync([
        "node",
        "aidev",
        "run",
        "--issue",
        "42",
        "--cwd",
        "/tmp/repo",
        "-y",
      ])
    ).rejects.toThrow(ExitError);
  });

  it("watch command exits with error when --repo is not specified", async () => {
    const cli = createCli();

    await expect(
      cli.parseAsync([
        "node",
        "aidev",
        "watch",
        "--cwd",
        "/tmp/repo",
      ])
    ).rejects.toThrow(ExitError);
  });
});
