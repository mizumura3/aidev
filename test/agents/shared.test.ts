import { describe, it, expect, vi } from "vitest";
import { blockDangerousOps, cleanEnvForSdk, extractJson, getBaseSdkOptions, findClaudeExecutable } from "../../src/agents/shared.js";

describe("blockDangerousOps", () => {
  describe("Bash tool", () => {
    it("blocks git push", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "git push origin main",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks git push with flags", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "git push -u origin feature/x",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks gh pr merge", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "gh pr merge 10 --squash",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks rm -rf /", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "rm -rf /",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks sudo commands", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "sudo rm -rf /tmp",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks gh issue close", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "gh issue close 5",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks git push --force", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "git push --force origin main",
      });
      expect(result.decision).toBe("block");
    });

    it("allows safe git commands", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "git status",
      });
      expect(result.decision).toBeUndefined();
    });

    it("allows bun test", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "bun test",
      });
      expect(result.decision).toBeUndefined();
    });

    it("allows ls and file reading", async () => {
      const result = await blockDangerousOps("Bash", {
        command: "ls -la src/",
      });
      expect(result.decision).toBeUndefined();
    });
  });

  describe("Read/Edit tool", () => {
    it("blocks reading .env files", async () => {
      const result = await blockDangerousOps("Read", {
        file_path: "/home/user/.env",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks reading .pem files", async () => {
      const result = await blockDangerousOps("Read", {
        file_path: "/home/user/key.pem",
      });
      expect(result.decision).toBe("block");
    });

    it("blocks reading id_rsa", async () => {
      const result = await blockDangerousOps("Edit", {
        file_path: "/home/user/.ssh/id_rsa",
      });
      expect(result.decision).toBe("block");
    });

    it("allows reading normal files", async () => {
      const result = await blockDangerousOps("Read", {
        file_path: "/home/user/project/src/main.ts",
      });
      expect(result.decision).toBeUndefined();
    });
  });

  describe("non-matching tools", () => {
    it("allows Glob tool", async () => {
      const result = await blockDangerousOps("Glob", { pattern: "**/*.ts" });
      expect(result.decision).toBeUndefined();
    });
  });
});

describe("cleanEnvForSdk", () => {
  function withEnv(vars: Record<string, string>, fn: () => void) {
    const originals: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) {
      originals[key] = process.env[key];
      process.env[key] = vars[key];
    }
    try {
      fn();
    } finally {
      for (const [key, orig] of Object.entries(originals)) {
        if (orig === undefined) delete process.env[key];
        else process.env[key] = orig;
      }
    }
  }

  it("removes CLAUDECODE marker", () => {
    withEnv({ CLAUDECODE: "1" }, () => {
      const env = cleanEnvForSdk();
      expect(env.CLAUDECODE).toBeUndefined();
    });
  });

  it("overrides CLAUDE_CODE_ENTRYPOINT to sdk-ts", () => {
    withEnv({ CLAUDE_CODE_ENTRYPOINT: "cli" }, () => {
      const env = cleanEnvForSdk();
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-ts");
    });
  });

  it("preserves other CLAUDE_CODE_ prefixed vars (feature flags etc)", () => {
    withEnv({ CLAUDE_CODE_SOME_FEATURE: "enabled" }, () => {
      const env = cleanEnvForSdk();
      expect(env.CLAUDE_CODE_SOME_FEATURE).toBe("enabled");
    });
  });

  it("preserves ANTHROPIC_API_KEY", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-test-key" }, () => {
      const env = cleanEnvForSdk();
      expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
    });
  });

  it("preserves non-CLAUDE env vars (HOME, PATH etc)", () => {
    const env = cleanEnvForSdk();
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.PATH).toBe(process.env.PATH);
  });
});

describe("findClaudeExecutable", () => {
  function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const originals: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) {
      originals[key] = process.env[key];
      if (vars[key] === undefined) delete process.env[key];
      else process.env[key] = vars[key];
    }
    try {
      fn();
    } finally {
      for (const [key, orig] of Object.entries(originals)) {
        if (orig === undefined) delete process.env[key];
        else process.env[key] = orig;
      }
    }
  }

  it("uses CLAUDE_EXECUTABLE env var when set", () => {
    withEnv({ CLAUDE_EXECUTABLE: "/custom/path/to/claude" }, () => {
      expect(findClaudeExecutable()).toBe("/custom/path/to/claude");
    });
  });

  it("skips node_modules/.bin entries from PATH", () => {
    withEnv({
      CLAUDE_EXECUTABLE: undefined,
      PATH: "/project/node_modules/.bin:/usr/local/bin",
    }, () => {
      // node_modules/.bin/claude should be skipped even if it exists
      // The function should not return a path containing node_modules
      const result = findClaudeExecutable();
      if (result) {
        expect(result).not.toContain("node_modules");
      }
    });
  });

  it("returns native binary path when found in PATH", () => {
    // Use the real PATH but without CLAUDE_EXECUTABLE override
    withEnv({ CLAUDE_EXECUTABLE: undefined }, () => {
      const result = findClaudeExecutable();
      // In CI or environments without claude installed, may be undefined
      if (result) {
        expect(result).toContain("claude");
        expect(result).not.toContain("node_modules");
      }
    });
  });

  it("returns undefined when no native binary found", () => {
    withEnv({
      CLAUDE_EXECUTABLE: undefined,
      PATH: "/nonexistent/dir:/another/nonexistent",
    }, () => {
      expect(findClaudeExecutable()).toBeUndefined();
    });
  });
});

describe("extractJson", () => {
  it("extracts JSON from pure JSON text", () => {
    const text = '{"summary":"test","steps":["step1"]}';
    const result = extractJson(text, "Test") as any;
    expect(result.summary).toBe("test");
  });

  it("extracts JSON embedded in prose", () => {
    const text = 'Here is the plan:\n{"summary":"test","steps":["step1"]}\nDone.';
    const result = extractJson(text, "Test") as any;
    expect(result.summary).toBe("test");
  });

  it("throws when no JSON found", () => {
    expect(() => extractJson("No JSON here", "Test")).toThrow("Test did not return JSON");
  });
});

describe("getBaseSdkOptions", () => {
  it("uses CLAUDE_EXECUTABLE env var when set", () => {
    const original = process.env.CLAUDE_EXECUTABLE;
    process.env.CLAUDE_EXECUTABLE = "/custom/path/to/claude";
    try {
      const opts = getBaseSdkOptions();
      expect(opts.pathToClaudeCodeExecutable).toBe("/custom/path/to/claude");
    } finally {
      if (original === undefined) delete process.env.CLAUDE_EXECUTABLE;
      else process.env.CLAUDE_EXECUTABLE = original;
    }
  });

  it("throws when no native binary found", () => {
    const origExe = process.env.CLAUDE_EXECUTABLE;
    const origPath = process.env.PATH;
    delete process.env.CLAUDE_EXECUTABLE;
    process.env.PATH = "/nonexistent/dir";
    try {
      expect(() => getBaseSdkOptions()).toThrow("Native Claude Code binary not found");
    } finally {
      if (origExe !== undefined) process.env.CLAUDE_EXECUTABLE = origExe;
      else delete process.env.CLAUDE_EXECUTABLE;
      process.env.PATH = origPath;
    }
  });
});
