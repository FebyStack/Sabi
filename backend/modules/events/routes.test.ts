import type { AddressInfo } from "node:net";
import { createApp } from "../../app/app";
import { makeTestDeps } from "../../shared/testing";

async function readFrames(res: Response, count: number): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const frames: string[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const f = buf.slice(0, i); buf = buf.slice(i + 2);
      if (f.startsWith("event:")) frames.push(f);
    }
  }
  reader.cancel();
  return frames;
}

describe("project events (SSE)", () => {
  it("streams the active job then live events", async () => {
    const deps = makeTestDeps();
    const server = createApp(deps).listen(0);
    const port = (server.address() as AddressInfo).port;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    deps.jobs.enqueue("p1", "captions", async () => { await gate; });
    await vi.waitFor(() => expect(deps.jobs.active("p1")).not.toBeNull());

    const res = await fetch(`http://127.0.0.1:${port}/api/projects/p1/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const framesP = readFrames(res, 2);
    release();
    const frames = await framesP;
    expect(frames[0]).toContain('"state":"PROCESSING"');
    expect(frames[1]).toContain('"state":"COMPLETE"');
    server.close();
  });
});
