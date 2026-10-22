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
    expect(jobErrorText("over_cap")).toBe("Monthly spending cap reached — see Usage.");
    expect(jobErrorText("transcriber_unavailable")).toBe("transcriber_unavailable");
  });
});

