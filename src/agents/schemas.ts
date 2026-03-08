import { zodToJsonSchema } from "zod-to-json-schema";
import { PlanSchema, ResultSchema, ReviewSchema, FixSchema } from "../types.js";

export const planJsonSchema = zodToJsonSchema(PlanSchema, { target: "jsonSchema7" }) as Record<string, unknown>;
export const resultJsonSchema = zodToJsonSchema(ResultSchema, { target: "jsonSchema7" }) as Record<string, unknown>;
export const reviewJsonSchema = zodToJsonSchema(ReviewSchema, { target: "jsonSchema7" }) as Record<string, unknown>;
export const fixJsonSchema = zodToJsonSchema(FixSchema, { target: "jsonSchema7" }) as Record<string, unknown>;
