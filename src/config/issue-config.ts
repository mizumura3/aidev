import { z } from "zod";
import { SkippableStateSchema } from "../types.js";
import type { SkippableState } from "../types.js";

export type { SkippableState } from "../types.js";

const IssueConfigSchema = z
  .object({
    maxFixAttempts: z.number().int().positive().optional(),
    autoMerge: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    base: z.string().optional(),
    skip: z.array(SkippableStateSchema).optional(),
    backend: z.string().optional(),
    model: z.string().optional(),
  })
  .strict();

export type IssueConfig = z.infer<typeof IssueConfigSchema>;

export interface ResolvedConfig {
  maxFixAttempts: number;
  autoMerge: boolean;
  dryRun: boolean;
  base: string;
  skip: SkippableState[];
  backend?: string;
  model?: string;
}

/**
 * Extract the content inside the first ```aidev ... ``` code fence.
 */
function extractAidevBlock(body: string): string | null {
  const match = body.match(/```aidev\s*\n([\s\S]*?)```/);
  return match?.[1] ?? null;
}

/**
 * Parse a simple YAML-like block into a raw key-value structure.
 * Supports:
 *   key: value
 *   key:
 *     - item
 *   # comment lines (skipped)
 */
function parseYamlLike(block: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const lines = block.split("\n");
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    const listItem = line.match(/^-\s+(.+)$/);
    if (listItem && currentKey) {
      if (!currentList) currentList = [];
      currentList.push(listItem[1]!.trim());
      continue;
    }

    // Flush previous list
    if (currentKey && currentList) {
      result[currentKey] = currentList;
      currentKey = null;
      currentList = null;
    }

    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1]!;
      const value = kv[2]!.trim();
      if (value === "") {
        // Start of a list
        currentKey = key;
        currentList = [];
      } else {
        result[key] = value;
      }
    }
  }

  // Flush final list
  if (currentKey && currentList) {
    result[currentKey] = currentList;
  }

  return result;
}

function toBoolean(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function toNumber(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Parse a YAML-like config block string into a partial IssueConfig.
 * Shared by issue body parser and .aidev.yml loader.
 */
export function parseConfigBlock(block: string): Partial<IssueConfig> {
  const raw = parseYamlLike(block);
  const obj: Record<string, unknown> = {};

  if (typeof raw.maxFixAttempts === "string") {
    const n = toNumber(raw.maxFixAttempts);
    if (n !== undefined) obj.maxFixAttempts = n;
  }

  if (typeof raw.autoMerge === "string") {
    const b = toBoolean(raw.autoMerge);
    if (b !== undefined) obj.autoMerge = b;
  }

  if (typeof raw.dryRun === "string") {
    const b = toBoolean(raw.dryRun);
    if (b !== undefined) obj.dryRun = b;
  }

  if (typeof raw.base === "string" && raw.base.length > 0) {
    obj.base = raw.base;
  }

  if (typeof raw.backend === "string" && raw.backend.length > 0) {
    obj.backend = raw.backend;
  }

  if (typeof raw.model === "string" && raw.model.length > 0) {
    obj.model = raw.model;
  }

  if (Array.isArray(raw.skip)) {
    const valid = raw.skip.filter(
      (s) => SkippableStateSchema.safeParse(s).success
    );
    if (valid.length > 0) obj.skip = valid;
  }

  return obj;
}

export function parseIssueConfig(body: string): Partial<IssueConfig> {
  const block = extractAidevBlock(body);
  if (!block) return {};
  return parseConfigBlock(block);
}
