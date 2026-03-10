import { z } from "zod";
import { SkippableStateSchema, LanguageSchema, RunStateSchema } from "../types.js";
import type { SkippableState, Language, RunState } from "../types.js";
import { MIN_STATE_TIMEOUT_MS, MAX_STATE_TIMEOUT_MS } from "../workflow/engine.js";

export type { SkippableState, Language } from "../types.js";
export { LanguageSchema } from "../types.js";

const IssueConfigSchema = z
  .object({
    maxFixAttempts: z.number().int().positive().optional(),
    maxReviewRounds: z.number().int().positive().optional(),
    autoMerge: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    base: z.string().optional(),
    skip: z.array(SkippableStateSchema).optional(),
    backend: z.string().optional(),
    model: z.string().optional(),
    language: LanguageSchema.optional(),
    stateTimeouts: z.record(RunStateSchema, z.number()).optional(),
  })
  .strict();

export type IssueConfig = z.infer<typeof IssueConfigSchema>;

export interface ResolvedConfig {
  maxFixAttempts: number;
  maxReviewRounds: number;
  autoMerge: boolean;
  dryRun: boolean;
  base: string;
  skip: SkippableState[];
  backend?: string;
  model?: string;
  language: Language;
  stateTimeouts?: Partial<Record<RunState, number>>;
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
function parseYamlLike(block: string): Record<string, string | string[] | Record<string, string>> {
  const result: Record<string, string | string[] | Record<string, string>> = {};
  const lines = block.split("\n");
  let currentKey: string | null = null;
  let currentList: string[] | null = null;
  let currentMap: Record<string, string> | null = null;

  function flushCurrent() {
    if (currentKey) {
      // List items (- item) and map items (key: value) under the same key are
      // mutually exclusive. If both are present (malformed input), list wins
      // and map entries are silently discarded. This is intentional — our
      // config format doesn't support mixed nested structures.
      if (currentList && currentList.length > 0) result[currentKey] = currentList;
      else if (currentMap && Object.keys(currentMap).length > 0) result[currentKey] = currentMap;
    }
    currentKey = null;
    currentList = null;
    currentMap = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    const isIndented = /^\s+/.test(rawLine);

    if (isIndented && currentKey) {
      const listItem = line.match(/^-\s+(.+)$/);
      if (listItem) {
        if (!currentList) currentList = [];
        currentList.push(listItem[1]!.trim());
        continue;
      }

      const nestedKv = line.match(/^(\w+)\s*:\s*(.+)$/);
      if (nestedKv) {
        if (!currentMap) currentMap = {};
        currentMap[nestedKv[1]!] = nestedKv[2]!.trim();
        continue;
      }
    }

    flushCurrent();

    const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (kv) {
      const key = kv[1]!;
      const value = kv[2]!.trim();
      if (value === "") {
        currentKey = key;
      } else {
        result[key] = value;
      }
    }
  }

  flushCurrent();
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

  if (typeof raw.maxReviewRounds === "string") {
    const n = toNumber(raw.maxReviewRounds);
    if (n !== undefined) obj.maxReviewRounds = n;
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
    // Only allow branch-name-safe characters; reject path traversal
    if (/^[a-zA-Z0-9._\-/]+$/.test(raw.base) && !raw.base.includes("..")) {
      obj.base = raw.base;
    }
  }

  if (typeof raw.backend === "string" && raw.backend.length > 0) {
    obj.backend = raw.backend;
  }

  if (typeof raw.model === "string" && raw.model.length > 0) {
    obj.model = raw.model;
  }

  if (typeof raw.language === "string" && LanguageSchema.safeParse(raw.language).success) {
    obj.language = raw.language;
  }

  if (Array.isArray(raw.skip)) {
    const valid = raw.skip.filter(
      (s) => SkippableStateSchema.safeParse(s).success
    );
    if (valid.length > 0) obj.skip = valid;
  }

  if (raw.stateTimeouts && typeof raw.stateTimeouts === "object" && !Array.isArray(raw.stateTimeouts)) {
    const map = raw.stateTimeouts as Record<string, string>;
    const timeouts: Partial<Record<RunState, number>> = {};
    for (const [key, val] of Object.entries(map)) {
      if (!RunStateSchema.safeParse(key).success) continue;
      const n = Number(val);
      if (Number.isFinite(n) && n >= MIN_STATE_TIMEOUT_MS && n <= MAX_STATE_TIMEOUT_MS) {
        timeouts[key as RunState] = n;
      }
    }
    if (Object.keys(timeouts).length > 0) obj.stateTimeouts = timeouts;
  }

  return obj;
}

export function parseIssueConfig(body: string): Partial<IssueConfig> {
  const block = extractAidevBlock(body);
  if (!block) return {};
  return parseConfigBlock(block);
}
