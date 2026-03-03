import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const TEMPLATE = `# aidev repo-level config
# Per-issue config (\`\`\`aidev block in issue body) overrides these.
# CLI flags override both.

maxFixAttempts: 3
autoMerge: false
dryRun: false
base: main
# skip:
#   - reviewing
#   - watching_ci
#   - documenter
`;

export function generateAidevYml(): string {
  return TEMPLATE;
}

export async function writeAidevYml(
  cwd: string,
  force: boolean,
): Promise<void> {
  const filePath = join(cwd, ".aidev.yml");

  if (!force) {
    try {
      await access(filePath);
      throw new Error(`.aidev.yml already exists at ${filePath}. Use --force to overwrite.`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  await writeFile(filePath, TEMPLATE);
}
