import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { FakeTranscriber, WhisperXTranscriber } from "./transcriber";
import fixture from "./fixtures/transcript-sample.json";

// Sidecar wire format: seconds, "start"/"end"/"score"
const sidecarBody = JSON.stringify({
  language: fixture.language,
  words: fixture.words.map((w) => ({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000, score: w.confidence })),
});

function serve(status: number, body: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => { res.writeHead(status, { "content-type": "application/json" }); res.end(body); });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

// A sidecar that accepts the connection and never answers (a hung or busy process).
const hang = (): Promise<{ server: Server; url: string }> => new Promise((resolve) => {
  const server = createServer(() => {});
  server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
});

describe("WhisperXTranscriber", () => {
  it("maps sidecar seconds to ms words with ids", async () => {
    const { server, url } = await serve(200, sidecarBody);
    const t = await new WhisperXTranscriber(url).transcribe(__filename, { language: "en" });
    server.close();
    expect(t.language).toBe("en");
    expect(t.words).toHaveLength(58);
    expect(t.words[0]).toEqual({ id: "w-0", text: "Here", startMs: 40, endMs: 290, confidence: 0.98 });
  });

  it("maps estimated_words to estimatedWords and omits it when zero", async () => {
    const body = (n: number) => JSON.stringify({ ...JSON.parse(sidecarBody), estimated_words: n });
    const some = await serve(200, body(3));
    const t = await new WhisperXTranscriber(some.url).transcribe(__filename);
    some.server.close();
    expect(t.estimatedWords).toBe(3);
    const none = await serve(200, body(0));
    const u = await new WhisperXTranscriber(none.url).transcribe(__filename);
    none.server.close();
    expect("estimatedWords" in u).toBe(false);
  });

  it("rejects with transcriber_unavailable on a 500", async () => {
    const { server, url } = await serve(500, "boom");
    await expect(new WhisperXTranscriber(url).transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
    server.close();
  });

  it("rejects with transcriber_timeout when the sidecar hangs past the timeout", async () => {
    const { server, url } = await hang();
    await expect(new WhisperXTranscriber(url, { timeoutMs: 200 }).transcribe(__filename)).rejects.toThrow("transcriber_timeout");
    server.closeAllConnections(); server.close();
  });

  it("rejects with transcriber_rejected only on the sidecar's 400 (unknown language); another 4xx is not whisperX refusing", async () => {
    const { server, url } = await serve(400, JSON.stringify({ detail: "unknown_language" }));
    await expect(new WhisperXTranscriber(url).transcribe(__filename, { language: "xx" })).rejects.toThrow("transcriber_rejected");
    server.close();
    const other = await serve(404, JSON.stringify({ detail: "Not Found" })); // a wrong WHISPERX_URL, or another server on :8010
    await expect(new WhisperXTranscriber(other.url).transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
    other.server.close();
  });

  it("health() is ok on a 2xx /health, down when refused, down within 1.5 s when hung", async () => {
    const up = await serve(200, JSON.stringify({ ok: true, model: "small" }));
    expect(await new WhisperXTranscriber(up.url).health()).toBe("ok");
    up.server.close();
    expect(await new WhisperXTranscriber("http://127.0.0.1:1").health()).toBe("down");
    const hung = await hang();
    const t0 = Date.now();
    expect(await new WhisperXTranscriber(hung.url).health()).toBe("down"); // the 1500 ms probe timeout, not the 30 min transcribe one
    expect(Date.now() - t0).toBeLessThan(2500);
    hung.server.closeAllConnections(); hung.server.close();
    expect(await new FakeTranscriber({ language: "en", words: [] }).health()).toBe("ok");
  });

  it("rejects with transcriber_unavailable on a malformed 200 body", async () => {
    const { server, url } = await serve(200, "not json");
    await expect(new WhisperXTranscriber(url).transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
    server.close();
  });

  it("rejects with transcriber_unavailable when the sidecar is down", async () => {
    await expect(new WhisperXTranscriber("http://127.0.0.1:1").transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
  });
});
