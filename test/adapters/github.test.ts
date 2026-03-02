import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createGitHubAdapter,
  type GitHubAdapter,
} from "../../src/adapters/github.js";

const { mockExeca } = vi.hoisted(() => ({
  mockExeca: vi.fn(),
}));
vi.mock("execa", () => ({
  execa: mockExeca,
}));

describe("GitHubAdapter", () => {
  let gh: GitHubAdapter;
  const repo = "mizumura3/inko";

  beforeEach(() => {
    vi.clearAllMocks();
    gh = createGitHubAdapter(repo);
  });

  describe("getIssue", () => {
    it("fetches issue with author and parses JSON", async () => {
      const issueJson = JSON.stringify({
        number: 1,
        title: "Bug",
        body: "Fix it",
        labels: [{ name: "bug" }],
        author: { login: "testuser" },
      });
      mockExeca.mockResolvedValue({ stdout: issueJson } as any);

      const issue = await gh.getIssue(1);

      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "issue",
        "view",
        "1",
        "--repo",
        repo,
        "--json",
        "number,title,body,labels,author",
      ]);
      expect(issue).toEqual({
        number: 1,
        title: "Bug",
        body: "Fix it",
        labels: ["bug"],
        author: "testuser",
      });
    });
  });

  describe("createPr", () => {
    it("creates PR and returns number parsed from URL", async () => {
      mockExeca.mockResolvedValue({
        stdout: "https://github.com/mizumura3/inko/pull/10\n",
      } as any);

      const prNumber = await gh.createPr({
        title: "feat: add X",
        body: "## Summary\nAdded X",
        head: "feature/x",
        base: "main",
      });

      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "pr",
        "create",
        "--repo",
        repo,
        "--title",
        "feat: add X",
        "--body",
        "## Summary\nAdded X",
        "--head",
        "feature/x",
        "--base",
        "main",
      ]);
      expect(prNumber).toBe(10);
    });
  });

  describe("getCiStatus", () => {
    it("returns passing when all checks pass", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify([
          { status: "completed", conclusion: "success" },
        ]),
      } as any);

      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("passing");
    });

    it("returns failing when a check fails", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify([
          { status: "completed", conclusion: "failure" },
        ]),
      } as any);

      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("failing");
    });

    it("returns pending when checks are in progress", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify([
          { status: "in_progress", conclusion: null },
        ]),
      } as any);

      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("pending");
    });

    it("returns no_checks when no checks exist", async () => {
      mockExeca.mockResolvedValue({ stdout: "[]" } as any);
      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("no_checks");
    });
  });

  describe("mergePr", () => {
    it("merges PR with squash", async () => {
      mockExeca.mockResolvedValue({ stdout: "" } as any);
      await gh.mergePr(10);
      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "pr",
        "merge",
        "10",
        "--repo",
        repo,
        "--squash",
        "--delete-branch",
      ]);
    });
  });

  describe("closeIssue", () => {
    it("closes issue", async () => {
      mockExeca.mockResolvedValue({ stdout: "" } as any);
      await gh.closeIssue(1);
      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "issue",
        "close",
        "1",
        "--repo",
        repo,
      ]);
    });
  });

  describe("commentOnIssue", () => {
    it("posts comment on issue via gh", async () => {
      mockExeca.mockResolvedValue({ stdout: "" } as any);
      await gh.commentOnIssue(4, "## Investigation\nFound the bug.");
      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "issue",
        "comment",
        "4",
        "--repo",
        repo,
        "--body",
        "## Investigation\nFound the bug.",
      ]);
    });
  });

  describe("getCheckRunLogs", () => {
    it("returns logs from the latest failed run", async () => {
      // First call: gh run list → returns a failed run
      mockExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([{ databaseId: 12345 }]),
      } as any);
      // Second call: gh run view --log-failed → returns log output
      mockExeca.mockResolvedValueOnce({
        stdout: "Error: test failed\n  at src/index.ts:10\n",
      } as any);

      const logs = await gh.getCheckRunLogs("feature/x");

      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "run",
        "list",
        "--repo",
        repo,
        "--branch",
        "feature/x",
        "--status",
        "failure",
        "--limit",
        "1",
        "--json",
        "databaseId",
      ]);
      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "run",
        "view",
        "12345",
        "--repo",
        repo,
        "--log-failed",
      ]);
      expect(logs).toBe("Error: test failed\n  at src/index.ts:10\n");
    });

    it("returns fallback message when no failed runs exist", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([]),
      } as any);

      const logs = await gh.getCheckRunLogs("feature/x");

      expect(logs).toBe("No failed CI runs found");
      expect(mockExeca).toHaveBeenCalledTimes(1);
    });

    it("truncates logs to the last 200 lines", async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: JSON.stringify([{ databaseId: 99 }]),
      } as any);
      const longLog = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
      mockExeca.mockResolvedValueOnce({
        stdout: longLog,
      } as any);

      const logs = await gh.getCheckRunLogs("feature/x");

      const lines = logs.split("\n");
      expect(lines).toHaveLength(200);
      expect(lines[0]).toBe("line 101");
      expect(lines[199]).toBe("line 300");
    });
  });

  describe("listIssuesByLabel", () => {
    it("returns issues with label and author", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify([
          { number: 1, title: "A", body: "a", labels: [{ name: "ai:run" }], author: { login: "user1" } },
          { number: 2, title: "B", body: "b", labels: [{ name: "ai:run" }], author: { login: "user2" } },
        ]),
      } as any);

      const issues = await gh.listIssuesByLabel("ai:run");

      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "issue",
        "list",
        "--repo",
        repo,
        "--label",
        "ai:run",
        "--json",
        "number,title,body,labels,author",
      ]);
      expect(issues).toHaveLength(2);
      expect(issues[0]!.number).toBe(1);
      expect(issues[0]!.author).toBe("user1");
      expect(issues[1]!.author).toBe("user2");
    });
  });

  describe("getAuthenticatedUser", () => {
    it("returns the authenticated user login", async () => {
      mockExeca.mockResolvedValue({ stdout: "myuser\n" } as any);

      const user = await gh.getAuthenticatedUser();

      expect(mockExeca).toHaveBeenCalledWith("gh", [
        "api",
        "user",
        "--jq",
        ".login",
      ]);
      expect(user).toBe("myuser");
    });
  });
});
