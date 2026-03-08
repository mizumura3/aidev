import { execa } from "execa";

export interface GitAdapter {
  createBranch(name: string, base: string, cwd: string): Promise<void>;
  addAll(cwd: string): Promise<void>;
  commit(message: string, cwd: string): Promise<void>;
  push(branch: string, cwd: string): Promise<void>;
  diff(base: string, cwd: string): Promise<string>;
  currentBranch(cwd: string): Promise<string>;
  addWorktree(path: string, baseBranch: string, cwd: string): Promise<void>;
  removeWorktree(path: string, cwd: string): Promise<void>;
}

export function createGitAdapter(): GitAdapter {
  return {
    async createBranch(name, base, cwd) {
      // `-B` creates the branch or resets it to the given base if it exists.
      await execa("git", ["checkout", "-B", name, base], { cwd });
    },

    async addAll(cwd) {
      await execa("git", ["add", "-A"], { cwd });
    },

    async commit(message, cwd) {
      try {
        await execa("git", ["commit", "-m", message], { cwd });
      } catch (err: any) {
        if (typeof err.stdout === "string" && err.stdout.includes("nothing to commit")) {
          return;
        }
        throw err;
      }
    },

    async push(branch, cwd) {
      try {
        await execa("git", ["push", "-u", "origin", branch], { cwd });
      } catch (err: any) {
        if (typeof err.stderr === "string" && err.stderr.includes("Everything up-to-date")) {
          return;
        }
        throw err;
      }
    },

    async diff(base, cwd) {
      const { stdout } = await execa("git", ["diff", `${base}...HEAD`], {
        cwd,
      });
      return stdout;
    },

    async currentBranch(cwd) {
      const { stdout } = await execa(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd }
      );
      return stdout.trim();
    },

    async addWorktree(path, baseBranch, cwd) {
      await execa("git", ["worktree", "add", path, baseBranch], { cwd });
    },

    async removeWorktree(path, cwd) {
      await execa("git", ["worktree", "remove", "--force", path], { cwd });
    },
  };
}
