import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function loadProjectInstructions(cwd: string): Promise<string> {
  const parts: string[] = [];

  // Read CLAUDE.md at project root
  try {
    const claudeMd = await readFile(join(cwd, "CLAUDE.md"), "utf-8");
    if (claudeMd.trim()) parts.push(claudeMd.trim());
  } catch {
    // File doesn't exist, skip
  }

  // Read .claude/rules/*.md files
  try {
    const rulesDir = join(cwd, ".claude", "rules");
    const entries = await readdir(rulesDir);
    const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
    for (const file of mdFiles) {
      try {
        const content = await readFile(join(rulesDir, file), "utf-8");
        if (content.trim()) parts.push(content.trim());
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist, skip
  }

  return parts.join("\n\n");
}
