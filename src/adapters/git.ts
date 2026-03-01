import { execa } from "execa";

export interface GitAdapter {
  createBranch(name: string, cwd: string): Promise<void>;
  addAll(cwd: string): Promise<void>;
  commit(message: string, cwd: string): Promise<void>;
  push(branch: string, cwd: string): Promise<void>;
  diff(base: string, cwd: string): Promise<string>;
  currentBranch(cwd: string): Promise<string>;
}

export function createGitAdapter(): GitAdapter {
  return {
    async createBranch(name, cwd) {
      try {
        await execa("git", ["checkout", "-b", name], { cwd });
      } catch {
        // Branch already exists — reset it from main
        await execa("git", ["checkout", "main"], { cwd });
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
  };
}
