import { describe, it, expect } from "vitest";
import { formatProgressEvent } from "../../src/agents/shared.js";

describe("formatProgressEvent", () => {
  it("extracts tool_use events with tool name", () => {
    const result = formatProgressEvent("Planner", {
      type: "tool_use",
      name: "Grep",
    } as any);

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.agent).toBe("Planner");
    expect(parsed.event).toBe("tool_use");
    expect(parsed.tool).toBe("Grep");
    expect(parsed.ts).toBeDefined();
  });

  it("extracts assistant message events", () => {
    const result = formatProgressEvent("Implementer", {
      type: "assistant",
      message: { id: "msg_1", model: "claude-opus-4-6" },
    } as any);

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.agent).toBe("Implementer");
    expect(parsed.event).toBe("assistant");
    expect(parsed.tool).toBeUndefined();
  });

  it("skips result messages", () => {
    const result = formatProgressEvent("Planner", {
      type: "result",
      subtype: "success",
      result: "{}",
    } as any);

    expect(result).toBeNull();
  });

  it("produces valid JSONL parseable by external consumers", () => {
    const events = [
      { type: "assistant", message: { id: "msg_1" } },
      { type: "tool_use", name: "Read" },
      { type: "tool_use", name: "Bash" },
    ];

    for (const event of events) {
      const line = formatProgressEvent("Reviewer", event as any);
      expect(line).not.toBeNull();
      // Should be valid JSON (single line)
      const parsed = JSON.parse(line!);
      expect(parsed.agent).toBe("Reviewer");
      expect(typeof parsed.ts).toBe("string");
      // Should not contain newlines
      expect(line).not.toContain("\n");
    }
  });

  it("includes subtype when present", () => {
    const result = formatProgressEvent("Fixer", {
      type: "error",
      subtype: "tool_error",
    } as any);

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.event).toBe("error");
    expect(parsed.subtype).toBe("tool_error");
  });

  it("handles state_transition event type with from/to states", () => {
    const result = formatProgressEvent("Workflow", {
      type: "state_transition" as any,
      from: "planning",
      to: "implementing",
    } as any);

    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.agent).toBe("Workflow");
    expect(parsed.event).toBe("state_transition");
    expect(parsed.from).toBe("planning");
    expect(parsed.to).toBe("implementing");
  });
});
