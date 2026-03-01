import { describe, it, expect } from "vitest";
import { blockDangerousOps } from "../../src/agents/shared.js";

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
