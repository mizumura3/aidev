import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createGitHubAdapter,
  type GitHubAdapter,
} from "../../src/adapters/github.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
const mockExeca = vi.mocked(execa);

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
    it("creates PR and returns number", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify({ number: 10, url: "https://github.com/..." }),
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
          { state: "SUCCESS", conclusion: "success" },
        ]),
      } as any);

      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("passing");
    });

    it("returns failing when a check fails", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify([
          { state: "FAILURE", conclusion: "failure" },
        ]),
      } as any);

      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("failing");
    });

    it("returns pending when checks are in progress", async () => {
      mockExeca.mockResolvedValue({
        stdout: JSON.stringify([
          { state: "PENDING", conclusion: "" },
        ]),
      } as any);

      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("pending");
    });

    it("returns passing when no checks", async () => {
      mockExeca.mockResolvedValue({ stdout: "[]" } as any);
      const status = await gh.getCiStatus("feature/x");
      expect(status).toBe("passing");
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
