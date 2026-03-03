import type { ResolvedConfig } from "./issue-config.js";

export function serializeConfig(config: ResolvedConfig): string {
  const lines: string[] = [
    `maxFixAttempts: ${config.maxFixAttempts}`,
    `autoMerge: ${config.autoMerge}`,
    `dryRun: ${config.dryRun}`,
    `base: ${config.base}`,
  ];

  if (config.skip.length > 0) {
    lines.push("skip:");
    for (const s of config.skip) {
      lines.push(`  - ${s}`);
    }
  }

  return lines.join("\n");
}

export function buildResolvedConfigBlock(config: ResolvedConfig): string {
  return `\`\`\`aidev\n${serializeConfig(config)}\n\`\`\``;
}

export function upsertAidevBlock(body: string, block: string): string {
  const pattern = /```aidev\s*\n[\s\S]*?```/;
  if (pattern.test(body)) {
    return body.replace(pattern, block);
  }
  if (!body) return block;
  return `${body}\n\n${block}`;
}
