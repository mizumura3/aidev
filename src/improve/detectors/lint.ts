import { execa } from "execa";
import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Detector, Finding } from "../types.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function createLintDetector(): Detector {
  return {
    name: "lint",
    async detect(cwd: string): Promise<Finding[]> {
      const hasEslint = await fileExists(join(cwd, "eslint.config.js")).then(
        (ok) => ok || fileExists(join(cwd, ".eslintrc.json")),
      );
      const hasBiome = await fileExists(join(cwd, "biome.json"));

      if (hasEslint) {
        return parseEslint(cwd);
      }
      if (hasBiome) {
        return parseBiome(cwd);
      }
      return [];
    },
  };
}

async function parseEslint(cwd: string): Promise<Finding[]> {
  const { stdout } = await execa("npx", ["eslint", ".", "--format", "json"], {
    cwd,
    reject: false,
  });

  try {
    const results: Array<{
      filePath: string;
      messages: Array<{ ruleId: string | null; message: string; line: number; column: number }>;
    }> = JSON.parse(stdout);

    const findings: Finding[] = [];
    for (const file of results) {
      for (const msg of file.messages) {
        const rule = msg.ruleId ?? "unknown";
        const relPath = relative(cwd, file.filePath);
        findings.push({
          title: `[aidev] Lint: ${rule} in ${relPath}`,
          body: `**Rule:** \`${rule}\`\n**File:** ${relPath}:${msg.line}\n**Message:** ${msg.message}`,
          category: "lint",
          filePath: relPath,
        });
      }
    }
    return findings;
  } catch {
    return [];
  }
}

async function parseBiome(cwd: string): Promise<Finding[]> {
  const { stdout } = await execa(
    "npx",
    ["biome", "lint", ".", "--reporter", "json"],
    { cwd, reject: false },
  );

  try {
    const result: {
      diagnostics: Array<{
        category: string;
        message: string;
        location?: { path?: { file?: string }; span?: { start?: { line?: number } } };
      }>;
    } = JSON.parse(stdout);

    return result.diagnostics.map((d) => {
      const filePath = d.location?.path?.file ?? "unknown";
      const relPath = relative(cwd, filePath);
      // Use relPath if it doesn't start with '..', otherwise use filePath as-is (already relative)
      const displayPath = relPath.startsWith("..") ? filePath : relPath;
      return {
        title: `[aidev] Lint: ${d.category} in ${displayPath}`,
        body: `**Rule:** \`${d.category}\`\n**File:** ${displayPath}\n**Message:** ${d.message}`,
        category: "lint" as const,
        filePath: displayPath,
      };
    });
  } catch {
    return [];
  }
}
