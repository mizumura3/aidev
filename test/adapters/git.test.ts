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
    it("creates new branch when it does not exist", async () => {
      await git.createBranch("feature/x", "main", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["checkout", "-b", "feature/x", "main"],
        { cwd }
      );
    });

    it("deletes existing branch then creates fresh one from base", async () => {
      const error = new Error("branch already exists");
      (error as any).exitCode = 128;
      mockExeca
        .mockRejectedValueOnce(error)       // checkout -b fails
        .mockResolvedValueOnce({ stdout: "" } as any)  // checkout base
        .mockResolvedValueOnce({ stdout: "" } as any)  // branch -D
        .mockResolvedValueOnce({ stdout: "" } as any); // checkout -b retry

      await git.createBranch("feature/x", "main", cwd);

      expect(mockExeca).toHaveBeenNthCalledWith(1, "git", ["checkout", "-b", "feature/x", "main"], { cwd });
      expect(mockExeca).toHaveBeenNthCalledWith(2, "git", ["checkout", "main"], { cwd });
      expect(mockExeca).toHaveBeenNthCalledWith(3, "git", ["branch", "-D", "feature/x"], { cwd });
      expect(mockExeca).toHaveBeenNthCalledWith(4, "git", ["checkout", "-b", "feature/x"], { cwd });
    });

    it("uses custom base for branch creation", async () => {
      await git.createBranch("feature/x", "v1.2.0", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["checkout", "-b", "feature/x", "v1.2.0"],
        { cwd }
      );
    });

    it("falls back to custom base when branch already exists", async () => {
      const error = new Error("branch already exists");
      (error as any).exitCode = 128;
      mockExeca
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ stdout: "" } as any)
        .mockResolvedValueOnce({ stdout: "" } as any)
        .mockResolvedValueOnce({ stdout: "" } as any);

      await git.createBranch("feature/x", "release/1.3", cwd);

      expect(mockExeca).toHaveBeenNthCalledWith(2, "git", ["checkout", "release/1.3"], { cwd });
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
