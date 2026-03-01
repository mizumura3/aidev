import { execa } from "execa";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Detector, Finding } from "../types.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isMajorBump(current: string, latest: string): boolean {
  const currentMajor = current.split(".")[0];
  const latestMajor = latest.split(".")[0];
  return currentMajor !== latestMajor;
}

export function createOutdatedDetector(): Detector {
  return {
    name: "outdated",
    async detect(cwd: string): Promise<Finding[]> {
      const hasBun = await fileExists(join(cwd, "bun.lock"));
      const hasNpm = await fileExists(join(cwd, "package-lock.json"));

      if (hasBun) {
        return parseBunOutdated(cwd);
      }
      if (hasNpm) {
        return parseNpmOutdated(cwd);
      }
      return [];
    },
  };
}

async function parseBunOutdated(cwd: string): Promise<Finding[]> {
  const { stdout } = await execa("bun", ["outdated", "--json"], {
    cwd,
    reject: false,
  });

  try {
    const pkgs: Array<{ name: string; current: string; latest: string }> =
      JSON.parse(stdout);

    return pkgs
      .filter((p) => isMajorBump(p.current, p.latest))
      .map((p) => ({
        title: `[aidev] Outdated: ${p.name} ${p.current} → ${p.latest}`,
        body: `**Package:** ${p.name}\n**Current:** ${p.current}\n**Latest:** ${p.latest}\n\nMajor version update available.`,
        category: "outdated" as const,
      }));
  } catch {
    return [];
  }
}

async function parseNpmOutdated(cwd: string): Promise<Finding[]> {
  const { stdout } = await execa("npm", ["outdated", "--json"], {
    cwd,
    reject: false,
  });

  try {
    const data: Record<string, { current: string; wanted: string; latest: string }> =
      JSON.parse(stdout);

    return Object.entries(data)
      .filter(([, v]) => isMajorBump(v.current, v.latest))
      .map(([name, v]) => ({
        title: `[aidev] Outdated: ${name} ${v.current} → ${v.latest}`,
        body: `**Package:** ${name}\n**Current:** ${v.current}\n**Latest:** ${v.latest}\n\nMajor version update available.`,
        category: "outdated" as const,
      }));
  } catch {
    return [];
  }
}
