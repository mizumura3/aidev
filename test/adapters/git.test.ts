import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGitAdapter, type GitAdapter } from "../../src/adapters/git.js";

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));
vi.mock("execa", () => ({
  execa: mockExeca,
}));

describe("GitAdapter", () => {
  let git: GitAdapter;
  const cwd = "/tmp/repo";

  beforeEach(() => {
    vi.clearAllMocks();
    git = createGitAdapter();
    mockExeca.mockResolvedValue({ stdout: "" } as any);
  });

  describe("createBranch", () => {
    it("creates new branch from base", async () => {
      await git.createBranch("feature/x", "main", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["checkout", "-B", "feature/x", "main"],
        { cwd }
      );
    });

    it("resets existing branch from base without deleting first", async () => {
      await git.createBranch("feature/x", "main", cwd);

      expect(mockExeca).toHaveBeenCalledTimes(1);
      expect(mockExeca).toHaveBeenNthCalledWith(
        1,
        "git",
        ["checkout", "-B", "feature/x", "main"],
        { cwd }
      );
    });

    it("uses custom base for branch creation", async () => {
      await git.createBranch("feature/x", "v1.2.0", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["checkout", "-B", "feature/x", "v1.2.0"],
        { cwd }
      );
    });

    it("uses custom base when resetting an existing branch", async () => {
      await git.createBranch("feature/x", "release/1.3", cwd);

      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["checkout", "-B", "feature/x", "release/1.3"],
        { cwd }
      );
    });
  });

  describe("addAll", () => {
    it("runs git add -A", async () => {
      await git.addAll(cwd);
      expect(mockExeca).toHaveBeenCalledWith("git", ["add", "-A"], { cwd });
    });
  });

  describe("commit", () => {
    it("runs git commit with message", async () => {
      await git.commit("feat: add X", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "feat: add X"],
        { cwd }
      );
    });

    it("silently succeeds when nothing to commit", async () => {
      const error = Object.assign(new Error("Command failed"), {
        exitCode: 1,
        stdout: "On branch main\nnothing to commit, working tree clean\n",
        stderr: "",
      });
      mockExeca.mockRejectedValueOnce(error);
      await expect(git.commit("feat: add X", cwd)).resolves.toBeUndefined();
    });

    it("re-throws genuine git errors", async () => {
      const error = Object.assign(new Error("Command failed"), {
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Unable to create '.git/index.lock': File exists.",
      });
      mockExeca.mockRejectedValueOnce(error);
      await expect(git.commit("feat: add X", cwd)).rejects.toThrow(
        "Command failed"
      );
    });
  });

  describe("push", () => {
    it("runs git push origin with branch", async () => {
      await git.push("feature/x", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["push", "-u", "origin", "feature/x"],
        { cwd }
      );
    });

    it("silently succeeds when everything up-to-date", async () => {
      const error = Object.assign(new Error("Command failed"), {
        exitCode: 1,
        stdout: "",
        stderr: "Everything up-to-date\n",
      });
      mockExeca.mockRejectedValueOnce(error);
      await expect(git.push("feature/x", cwd)).resolves.toBeUndefined();
    });

    it("re-throws genuine push errors", async () => {
      const error = Object.assign(new Error("Command failed"), {
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Authentication failed",
      });
      mockExeca.mockRejectedValueOnce(error);
      await expect(git.push("feature/x", cwd)).rejects.toThrow(
        "Command failed"
      );
    });
  });

  describe("diff", () => {
    it("runs git diff and returns stdout", async () => {
      mockExeca.mockResolvedValue({ stdout: "diff output" } as any);
      const result = await git.diff("main", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["diff", "main...HEAD"],
        { cwd }
      );
      expect(result).toBe("diff output");
    });
  });

  describe("currentBranch", () => {
    it("returns current branch name trimmed", async () => {
      mockExeca.mockResolvedValue({ stdout: "  main\n" } as any);
      const branch = await git.currentBranch(cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd }
      );
      expect(branch).toBe("main");
    });
  });

  describe("addWorktree", () => {
    it("runs git worktree add with path and branch", async () => {
      await git.addWorktree("/tmp/wt-42", "main", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "/tmp/wt-42", "main"],
        { cwd }
      );
    });
  });

  describe("removeWorktree", () => {
    it("runs git worktree remove --force with path", async () => {
      await git.removeWorktree("/tmp/wt-42", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "--force", "/tmp/wt-42"],
        { cwd }
      );
    });
  });
});
