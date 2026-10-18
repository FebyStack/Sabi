import { initialEventsState, reduceProjectEvents } from "./projectEvents";

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
});
