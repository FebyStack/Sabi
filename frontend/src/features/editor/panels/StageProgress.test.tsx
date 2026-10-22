import { renderToStaticMarkup } from "react-dom/server";
import { StageProgress } from "./StageProgress";

describe("StageProgress", () => {
  it("names the stage and percent, or says the job is queued", () => {
    expect(renderToStaticMarkup(<StageProgress view={{ stage: "generating", pct: 40 }} />)).toMatch(/role="status"[^>]*>Generating B-roll 40%</);
    expect(renderToStaticMarkup(<StageProgress view={{ stage: "rendering", pct: 0 }} queued />)).toMatch(/role="status"[^>]*>Queued — another project&#x27;s job is running</);
  });
});
