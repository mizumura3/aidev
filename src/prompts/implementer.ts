import { INJECTION_DEFENSE_PROMPT, wrapUntrustedContent } from "./shared.js";
import type { Plan } from "../types.js";

export interface BuildImplementerPromptInput {
  plan: Plan;
  workItemKind: "issue" | "pr";
  workItemNumber: number;
}

export function buildImplementerPrompt(input: BuildImplementerPromptInput): string {
  const label = input.workItemKind === "pr" ? "PR" : "issue";
  const relatedLine =
    input.workItemKind === "issue"
      ? `## 関連 Issue
closes #${input.workItemNumber}`
      : `## 関連PR
improves #${input.workItemNumber}`;

  return `You are an implementation agent. Implement the following plan for ${label} #${input.workItemNumber}.

${INJECTION_DEFENSE_PROMPT}

${wrapUntrustedContent("plan", JSON.stringify(input.plan, null, 2))}

Requirements:
1. Follow TDD - write tests first, then implement
2. Run tests to verify your implementation works
3. Keep changes minimal and focused

When you are done, respond ONLY with a JSON object:
{
  "changeSummary": "string - what you changed",
  "changedFiles": ["string[] - files modified"],
  "testsRun": true/false,
  "commitMessageDraft": "string - conventional commit message",
  "prBodyDraft": "string - PR description in markdown, following the format below"
}

The prBodyDraft MUST follow this format:
## 概要
<this PR's purpose>

## 変更内容
- <bullet list of changes>

## テスト
- [ ] 既存テストがパスすることを確認
- [ ] 必要に応じて新規テストを追加

${relatedLine}

Output ONLY valid JSON, no markdown fences.`;
}
