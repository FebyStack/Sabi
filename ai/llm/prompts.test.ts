import { z } from "zod";
import { llmPlanSchema } from "./prompts";

describe("llmPlanSchema", () => {
  it("emits no safe-integer bounds, which llama.cpp would expand digit by digit into the grammar", () => {
    const json = JSON.stringify(z.toJSONSchema(llmPlanSchema(10)));
    expect(json).not.toContain("9007199254740991");
    expect(json).toContain('"maxItems":10');
  });
});
