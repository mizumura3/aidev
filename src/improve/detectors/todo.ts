import { execa } from "execa";
import type { Detector, Finding } from "../types.js";

export function createTodoDetector(): Detector {
  return {
    name: "todo",
    async detect(cwd: string): Promise<Finding[]> {
      try {
        const { stdout } = await execa(
          "grep",
          [
            "-rn",
            "--include=*.ts",
            "--include=*.tsx",
            "--include=*.js",
            "--include=*.jsx",
            "--exclude-dir=node_modules",
            "--exclude-dir=dist",
            "--exclude-dir=.git",
            "-E",
            "TODO|FIXME",
            ".",
          ],
          { cwd },
        );

        if (!stdout.trim()) return [];

        return stdout
          .trim()
          .split("\n")
          .map((line) => {
            // Format: ./src/utils.ts:10:  // TODO: refactor this function
            const normalized = line.startsWith("./") ? line.slice(2) : line;
            const firstColon = normalized.indexOf(":");
            const secondColon = normalized.indexOf(":", firstColon + 1);
            const filePath = normalized.slice(0, firstColon);
            const lineNum = normalized.slice(firstColon + 1, secondColon);

            return {
              title: `[aidev] TODO in ${filePath}:${lineNum}`,
              body: `Found TODO/FIXME comment:\n\n\`\`\`\n${normalized}\n\`\`\``,
              category: "todo" as const,
              filePath,
            };
          });
      } catch {
        // grep returns exit code 1 when no matches found
        return [];
      }
    },
  };
}
