import { z } from "zod";
import { PLAN_SYSTEM, llmPlanSchema, planSystem } from "./prompts";

describe("planSystem", () => {
  it("adds the Tagalog note for tl only", () => {
    expect(planSystem("tl")).toContain("Taglish");
    expect(planSystem("tl").startsWith(PLAN_SYSTEM)).toBe(true);
    expect(planSystem("en")).toBe(PLAN_SYSTEM);
    expect(planSystem(null)).toBe(PLAN_SYSTEM);
  });
});

describe("llmPlanSchema", () => {
  it("emits no safe-integer bounds, which llama.cpp would expand digit by digit into the grammar", () => {
    const json = JSON.stringify(z.toJSONSchema(llmPlanSchema(10)));
    expect(json).not.toContain("9007199254740991");
    expect(json).toContain('"maxItems":10');
  });
});
