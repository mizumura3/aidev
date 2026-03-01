import { execa } from "execa";

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface CreatePrOpts {
  title: string;
  body: string;
  head: string;
  base: string;
}

export type CiStatus = "passing" | "failing" | "pending";

export interface CreateIssueOpts {
  title: string;
  body: string;
  labels: string[];
}

export interface GitHubAdapter {
  getIssue(number: number): Promise<Issue>;
  commentOnIssue(number: number, body: string): Promise<void>;
  createPr(opts: CreatePrOpts): Promise<number>;
  getCiStatus(branch: string): Promise<CiStatus>;
  mergePr(number: number): Promise<void>;
  closeIssue(number: number): Promise<void>;
  listIssuesByLabel(label: string): Promise<Issue[]>;
  getCheckRunLogs(branch: string): Promise<string>;
  createIssue(opts: CreateIssueOpts): Promise<number>;
  searchIssues(query: string): Promise<Issue[]>;
}

export function createGitHubAdapter(repo: string): GitHubAdapter {
  return {
    async getIssue(number) {
      const { stdout } = await execa("gh", [
        "issue",
        "view",
        String(number),
        "--repo",
        repo,
        "--json",
        "number,title,body,labels",
      ]);
      const raw = JSON.parse(stdout);
      return {
        number: raw.number,
        title: raw.title,
        body: raw.body,
        labels: raw.labels.map((l: { name: string }) => l.name),
      };
    },

    async commentOnIssue(number, body) {
      await execa("gh", [
        "issue",
        "comment",
        String(number),
        "--repo",
        repo,
        "--body",
        body,
      ]);
    },

    async createPr(opts) {
      const { stdout } = await execa("gh", [
        "pr",
        "create",
        "--repo",
        repo,
        "--title",
        opts.title,
        "--body",
        opts.body,
        "--head",
        opts.head,
        "--base",
        opts.base,
      ]);
      const match = stdout.trim().match(/\/pull\/(\d+)$/);
      if (!match) throw new Error(`unexpected gh pr create output: ${stdout}`);
      return Number(match[1]);
    },

    async getCiStatus(branch) {
      const { stdout } = await execa("gh", [
        "api",
        `repos/${repo}/commits/${branch}/check-runs`,
        "--jq",
        ".check_runs | map({status: .status, conclusion: .conclusion})",
      ]);
      const checks: Array<{ status: string; conclusion: string | null }> =
        JSON.parse(stdout);

      if (checks.length === 0) return "pending";
      if (checks.some((c) => c.conclusion === "failure")) return "failing";
      if (checks.some((c) => c.status !== "completed")) return "pending";
      return "passing";
    },

    async mergePr(number) {
      await execa("gh", [
        "pr",
        "merge",
        String(number),
        "--repo",
        repo,
        "--squash",
        "--delete-branch",
      ]);
    },

    async closeIssue(number) {
      await execa("gh", [
        "issue",
        "close",
        String(number),
        "--repo",
        repo,
      ]);
    },

    async getCheckRunLogs(branch) {
      const { stdout: listOut } = await execa("gh", [
        "run",
        "list",
        "--repo",
        repo,
        "--branch",
        branch,
        "--status",
        "failure",
        "--limit",
        "1",
        "--json",
        "databaseId",
      ]);
      const runs: Array<{ databaseId: number }> = JSON.parse(listOut);
      if (runs.length === 0) return "No failed CI runs found";

      const { stdout: logOut } = await execa("gh", [
        "run",
        "view",
        String(runs[0]!.databaseId),
        "--repo",
        repo,
        "--log-failed",
      ]);

      const lines = logOut.split("\n");
      if (lines.length > 200) {
        return lines.slice(-200).join("\n");
      }
      return logOut;
    },

    async listIssuesByLabel(label) {
      const { stdout } = await execa("gh", [
        "issue",
        "list",
        "--repo",
        repo,
        "--label",
        label,
        "--json",
        "number,title,body,labels",
      ]);
      const raw: Array<{
        number: number;
        title: string;
        body: string;
        labels: Array<{ name: string }>;
      }> = JSON.parse(stdout);
      return raw.map((r) => ({
        number: r.number,
        title: r.title,
        body: r.body,
        labels: r.labels.map((l) => l.name),
      }));
    },

    async createIssue(opts) {
      const args = [
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        opts.title,
        "--body",
        opts.body,
      ];
      for (const label of opts.labels) {
        args.push("--label", label);
      }
      const { stdout } = await execa("gh", args);
      const match = stdout.trim().match(/\/issues\/(\d+)$/);
      if (!match) throw new Error(`unexpected gh issue create output: ${stdout}`);
      return Number(match[1]);
    },

    async searchIssues(query) {
      const { stdout } = await execa("gh", [
        "search",
        "issues",
        "--repo",
        repo,
        "--state",
        "open",
        "--json",
        "number,title,body,labels",
        "--",
        query,
      ]);
      const raw: Array<{
        number: number;
        title: string;
        body: string;
        labels: Array<{ name: string }>;
      }> = JSON.parse(stdout);
      return raw.map((r) => ({
        number: r.number,
        title: r.title,
        body: r.body,
        labels: r.labels.map((l) => l.name),
      }));
    },
  };
}
