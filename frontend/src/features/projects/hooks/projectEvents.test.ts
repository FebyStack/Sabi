import { initialEventsState, jobErrorText, reduceProjectEvents } from "./projectEvents";

describe("reduceProjectEvents", () => {
  it("tracks stage and progress from job events", () => {
    const s = reduceProjectEvents(initialEventsState, { type: "job", job: { id: "j", projectId: "p", kind: "captions", state: "PROCESSING", stage: "transcribe", progress: 40 } });
    expect(s).toMatchObject({ stage: "transcribe", progress: 40, error: null });
  });

  it("records the error of a FAILED job", () => {
    const s = reduceProjectEvents(initialEventsState, { type: "job", job: { id: "j", projectId: "p", kind: "captions", state: "FAILED", progress: 40, error: "boom" } });
    expect(s.error).toBe("boom");
  });

  it("sets status from project events and clears a stale error on a new job", () => {
    let s = reduceProjectEvents(initialEventsState, { type: "project", status: "transcribing" });
    expect(s.status).toBe("transcribing");
    s = reduceProjectEvents({ ...s, error: "old" }, { type: "job", job: { id: "j2", projectId: "p", kind: "captions", state: "QUEUED", progress: 0 } });
    expect(s.error).toBeNull();
    expect(s.progress).toBe(0);
  });

  it("tracks the job kind", () => {
    const s = reduceProjectEvents(initialEventsState, { type: "job", job: { id: "j", projectId: "p", kind: "plan", state: "PROCESSING", stage: "plan", progress: 10 } });
    expect(s.kind).toBe("plan");
  });

  it("queued and running follow the job state", () => {
    const job = (state: "QUEUED" | "PROCESSING" | "COMPLETE" | "FAILED") => ({ type: "job" as const, job: { id: "j", projectId: "p", kind: "generate", state, progress: 0 } });
    let s = reduceProjectEvents(initialEventsState, job("QUEUED"));
    expect(s).toMatchObject({ running: true, queued: true });
    s = reduceProjectEvents(s, job("PROCESSING"));
    expect(s).toMatchObject({ running: true, queued: false });
    expect(reduceProjectEvents(s, job("COMPLETE"))).toMatchObject({ running: false, queued: false });
    expect(reduceProjectEvents(s, job("FAILED"))).toMatchObject({ running: false, queued: false });
    expect(initialEventsState).toMatchObject({ running: false, queued: false });
  });

  it("jobErrorText explains restarts and the cap", () => {
    expect(jobErrorText("interrupted")).toBe("Interrupted by a restart — run it again.");
    expect(jobErrorText("already_ran")).toBe("It ran, but a restart lost its result — check the B-roll before running it again.");
    expect(jobErrorText("over_cap")).toBe("Monthly spending cap reached — see Usage.");
    expect(jobErrorText("no_source")).toBe("no_source"); // an unknown code reads as itself
  });

  it("jobErrorText says which local service failed and how", () => {
    expect(jobErrorText("transcriber_unavailable")).toBe("whisperX isn't running — start it with npm run ai:whisperx.");
    expect(jobErrorText("transcriber_timeout")).toBe("whisperX took too long (30 min) — try a shorter clip or check the sidecar's log.");
    expect(jobErrorText("transcriber_rejected")).toBe("whisperX refused the spoken language — pick another in Spoken language.");
    expect(jobErrorText("llm_unavailable")).toBe("Ollama isn't running — start it with npm run ai:ollama.");
    expect(jobErrorText("llm_timeout")).toBe("Ollama took too long (10 min) — try again or a smaller model.");
    expect(jobErrorText("llm_model_missing")).toBe("Ollama has no model to run — ollama pull the OLLAMA_MODEL.");
    expect(jobErrorText("llm_invalid_output")).toBe("Ollama's answer never fit the plan format — run Plan edit again.");
  });

  it("jobErrorText explains a render refused for disk space", () => {
    expect(jobErrorText("disk_low")).toBe("Not enough free disk for a render — free 2 GB on this Mac (npm run doctor).");
  });

  it("jobErrorText names the missing key and a fal timeout", () => {
    expect(jobErrorText("generator_unavailable")).toBe("fal.ai isn't set up: add FAL_KEY to the API, or switch B-roll to Stock only.");
    expect(jobErrorText("stock_unavailable")).toBe("Pexels isn't set up: add PEXELS_KEY to the API.");
    expect(jobErrorText("generator_timeout")).toBe("fal.ai took too long; the attempt was still charged. Try again, or use stock.");
  });
});

