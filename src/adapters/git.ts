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
      try {
        await execa("git", ["checkout", "-b", name, base], { cwd });
      } catch {
        // Branch already exists — reset it from base
        await execa("git", ["checkout", base], { cwd });
        await execa("git", ["branch", "-D", name], { cwd });
        await execa("git", ["checkout", "-b", name], { cwd });
      }
    },

    async addAll(cwd) {
      await execa("git", ["add", "-A"], { cwd });
    },

    async commit(message, cwd) {
      await execa("git", ["commit", "-m", message], { cwd });
    },

    async push(branch, cwd) {
      await execa("git", ["push", "-u", "origin", branch], { cwd });
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
