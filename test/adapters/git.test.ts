import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGitAdapter, type GitAdapter } from "../../src/adapters/git.js";

const mockExeca = vi.fn();
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
      await git.createBranch("feature/x", cwd);
      expect(mockExeca).toHaveBeenCalledWith(
        "git",
        ["checkout", "-b", "feature/x"],
        { cwd }
      );
    });

    it("deletes existing branch then creates fresh one", async () => {
      const error = new Error("branch already exists");
      (error as any).exitCode = 128;
      mockExeca
        .mockRejectedValueOnce(error)       // checkout -b fails
        .mockResolvedValueOnce({ stdout: "" } as any)  // checkout main
        .mockResolvedValueOnce({ stdout: "" } as any)  // branch -D
        .mockResolvedValueOnce({ stdout: "" } as any); // checkout -b retry

      await git.createBranch("feature/x", cwd);

      expect(mockExeca).toHaveBeenNthCalledWith(1, "git", ["checkout", "-b", "feature/x"], { cwd });
      expect(mockExeca).toHaveBeenNthCalledWith(2, "git", ["checkout", "main"], { cwd });
      expect(mockExeca).toHaveBeenNthCalledWith(3, "git", ["branch", "-D", "feature/x"], { cwd });
      expect(mockExeca).toHaveBeenNthCalledWith(4, "git", ["checkout", "-b", "feature/x"], { cwd });
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
});
