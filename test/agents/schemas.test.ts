import { describe, it, expect } from "vitest";
import { planJsonSchema, resultJsonSchema, reviewJsonSchema, fixJsonSchema } from "../../src/agents/schemas.js";

describe("JSON Schema exports", () => {
  it("planJsonSchema is a valid JSON Schema 7 object", () => {
    expect(planJsonSchema).toHaveProperty("type", "object");
    expect(planJsonSchema).toHaveProperty("properties");
    const props = planJsonSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("summary");
    expect(props).toHaveProperty("steps");
    expect(props).toHaveProperty("filesToTouch");
    expect(props).toHaveProperty("tests");
    expect(props).toHaveProperty("risks");
    expect(props).toHaveProperty("acceptanceCriteria");
  });

  it("planJsonSchema marks required fields correctly", () => {
    const required = planJsonSchema.required as string[];
    expect(required).toContain("summary");
    expect(required).toContain("steps");
    // investigation is optional
    expect(required).not.toContain("investigation");
  });

  it("resultJsonSchema has all required fields", () => {
    expect(resultJsonSchema).toHaveProperty("type", "object");
    const props = resultJsonSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("changeSummary");
    expect(props).toHaveProperty("changedFiles");
    expect(props).toHaveProperty("testsRun");
    expect(props).toHaveProperty("commitMessageDraft");
    expect(props).toHaveProperty("prBodyDraft");
  });

  it("reviewJsonSchema has decision enum", () => {
    expect(reviewJsonSchema).toHaveProperty("type", "object");
    const props = reviewJsonSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.decision).toHaveProperty("enum");
    expect(props.decision.enum).toContain("approve");
    expect(props.decision.enum).toContain("changes_requested");
    expect(props.decision.enum).toContain("needs_discussion");
  });

  it("fixJsonSchema has all required fields", () => {
    expect(fixJsonSchema).toHaveProperty("type", "object");
    const props = fixJsonSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("rootCause");
    expect(props).toHaveProperty("fixPlan");
    expect(props).toHaveProperty("filesToTouch");
  });

  it("all schemas have $schema or type field indicating JSON Schema", () => {
    for (const schema of [planJsonSchema, resultJsonSchema, reviewJsonSchema, fixJsonSchema]) {
      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
