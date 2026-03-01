import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createGitHubAdapter,
  type GitHubAdapter,
} from "../../src/adapters/github.js";

const mockExeca = vi.fn();
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
    it("fetches issue and parses JSON", async () => {
      const issueJson = JSON.stringify({
        number: 1,
        title: "Bug",
        body: "Fix it",
        labels: [{ name: "bug" }],
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
        "number,title,body,labels",
      ]);
      expect(issue).toEqual({
        number: 1,
        title: "Bug",
        body: "Fix it",
        labels: ["bug"],
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

    it("returns pending when no checks exist (push race condition)", async () => {
      mockExeca.mockResolvedValue({ stdout: "[]" } as any);
      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("pending");
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

  describe("listIssuesByLabel", () => {
    it("returns issues with label", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify([
          { number: 1, title: "A", body: "a", labels: [{ name: "ai:run" }] },
          { number: 2, title: "B", body: "b", labels: [{ name: "ai:run" }] },
        ]),
      } as any);

      const issues = await gh.listIssuesByLabel("ai:run");
      expect(issues).toHaveLength(2);
      expect(issues[0]!.number).toBe(1);
    });
  });
});
