import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfigBlock, type IssueConfig } from "./issue-config.js";

export async function loadRepoConfig(
  cwd: string,
): Promise<Partial<IssueConfig>> {
  try {
    const content = await readFile(join(cwd, ".aidev.yml"), "utf-8");
    return parseConfigBlock(content);
  } catch {
    return {};
  }
}
