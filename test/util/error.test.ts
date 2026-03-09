import { describe, it, expect } from "vitest";
import { formatErrorDetails } from "../../src/util/error.js";

describe("formatErrorDetails", () => {
  it("returns string representation for non-Error values", () => {
    expect(formatErrorDetails("something broke")).toEqual({
      error: "something broke",
    });
    expect(formatErrorDetails(42)).toEqual({ error: "42" });
    expect(formatErrorDetails(null)).toEqual({ error: "null" });
  });

  it("includes stack trace for Error objects", () => {
    const err = new Error("test error");
    const details = formatErrorDetails(err);
    expect(details.error).toBe("test error");
    expect(details.stack).toContain("test error");
    expect(details.stack).toContain("error.test.ts");
  });

  it("includes stderr, exitCode, command for ExecaError-like objects", () => {
    const err = Object.assign(new Error("Command failed"), {
      stderr: "fatal: not a git repository",
      exitCode: 128,
      command: "git status",
    });
    const details = formatErrorDetails(err);
    expect(details.error).toBe("Command failed");
    expect(details.stderr).toBe("fatal: not a git repository");
    expect(details.exitCode).toBe(128);
    expect(details.command).toBe("git status");
    expect(details.stack).toBeDefined();
  });

  it("truncates long stderr to 1000 chars", () => {
    const longStderr = "x".repeat(2000);
    const err = Object.assign(new Error("fail"), { stderr: longStderr });
    const details = formatErrorDetails(err);
    expect(details.stderr!.length).toBeLessThan(1100);
    expect(details.stderr).toContain("...(truncated)");
  });

  it("does not include ExecaError fields when not present", () => {
    const err = new Error("plain error");
    const details = formatErrorDetails(err);
    expect(details.stderr).toBeUndefined();
    expect(details.exitCode).toBeUndefined();
    expect(details.command).toBeUndefined();
  });
});
