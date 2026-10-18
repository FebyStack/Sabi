import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WhisperXTranscriber } from "./transcriber";
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

describe("WhisperXTranscriber", () => {
  it("maps sidecar seconds to ms words with ids", async () => {
    const { server, url } = await serve(200, sidecarBody);
    const t = await new WhisperXTranscriber(url).transcribe(__filename, { language: "en" });
    server.close();
    expect(t.language).toBe("en");
    expect(t.words).toHaveLength(58);
    expect(t.words[0]).toEqual({ id: "w-0", text: "Here", startMs: 40, endMs: 290, confidence: 0.98 });
  });

  it("rejects with transcriber_unavailable on a 500", async () => {
    const { server, url } = await serve(500, "boom");
    await expect(new WhisperXTranscriber(url).transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
    server.close();
  });

  it("rejects with transcriber_unavailable when the sidecar is down", async () => {
    await expect(new WhisperXTranscriber("http://127.0.0.1:1").transcribe(__filename)).rejects.toThrow("transcriber_unavailable");
  });
});
