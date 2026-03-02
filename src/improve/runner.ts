import type { GitHubAdapter } from "../adapters/github.js";
import type { Logger } from "../util/logger.js";
import type { Detector, Finding } from "./types.js";

export interface ImproveOptions {
  cwd: string;
  repo: string;
  detectors: Detector[];
  github: GitHubAdapter;
  logger: Logger;
  dryRun: boolean;
}

export async function runImprove(opts: ImproveOptions): Promise<void> {
  const { detectors, github, logger, dryRun, cwd } = opts;

  // Run all detectors
  const allFindings: Finding[] = [];
  for (const detector of detectors) {
    logger.info("Running detector", { name: detector.name });
    const findings = await detector.detect(cwd);
    logger.info("Detector completed", { name: detector.name, count: findings.length });
    allFindings.push(...findings);
  }

  if (allFindings.length === 0) {
    logger.info("No findings detected");
    return;
  }

  // Fetch existing open issues for deduplication
  const existingIssues = await github.searchIssues("[aidev]");
  const existingTitles = new Set(existingIssues.map((i) => i.title));

  // Create issues for new findings
  for (const finding of allFindings) {
    if (existingTitles.has(finding.title)) {
      logger.info("Skipping duplicate", { title: finding.title });
      continue;
    }

    if (dryRun) {
      logger.info("Dry run: would create issue", {
        title: finding.title,
        category: finding.category,
      });
      continue;
    }

    const issueNumber = await github.createIssue({
      title: finding.title,
      body: finding.body,
      labels: ["auto-merge"],
    });
    logger.info("Created issue", { number: issueNumber, title: finding.title });
  }
}
