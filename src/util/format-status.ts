import type { RunContext } from "../types.js";

export function formatStatus(ctx: RunContext): string {
  const lines: string[] = [];

  lines.push(fmt("State", ctx.state));
  lines.push(fmt("Run ID", ctx.runId));

  const issue = ctx.issueTitle
    ? `#${ctx.issueNumber} - ${ctx.issueTitle}`
    : `#${ctx.issueNumber}`;
  lines.push(fmt("Issue", issue));

  lines.push(fmt("Repo", ctx.repo));
  lines.push(fmt("Branch", ctx.branch));
  lines.push(fmt("Base", ctx.base));

  if (ctx.prNumber != null) {
    lines.push(fmt("PR", `#${ctx.prNumber}`));
  }

  if (ctx.review) {
    lines.push(fmt("Review", ctx.review.decision));
  }

  if (ctx.state === "fixing" || ctx.fixAttempts > 0) {
    lines.push(fmt("Fix Attempts", `${ctx.fixAttempts}/${ctx.maxFixAttempts}`));
  }

  if (ctx.dryRun) {
    lines.push(fmt("Dry Run", "true"));
  }

  if (ctx.autoMerge) {
    lines.push(fmt("Auto Merge", "true"));
  }

  return lines.join("\n");
}

function fmt(label: string, value: string): string {
  return `${(label + ":").padEnd(14)}${value}`;
}
