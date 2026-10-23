import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WhisperXTranscriber } from "../../backend/shared/transcriber";

// Febriel reading ai/evaluation/fixtures/tagalog-sample.txt: 16 kHz mono WAV, ~12 s
// (ffmpeg -i rec.m4a -ac 1 -ar 16000 ai/evaluation/fixtures/tagalog-sample.wav).
const FIXTURE = fileURLToPath(new URL("../../ai/evaluation/fixtures/tagalog-sample.wav", import.meta.url));
const SLOW = 600_000; // the first tl run downloads the 1.26 GB aligner into HF_HOME

// Real whisperX; needs the sidecar running (npm run ai:whisperx). Opt in with RUN_TRANSCRIBE=1 (npm run transcribe:sample).
describe.skipIf(process.env.RUN_TRANSCRIBE !== "1" || !existsSync(FIXTURE))("whisperX on a Tagalog sample", () => {
  const whisperx = new WhisperXTranscriber(process.env.WHISPERX_URL ?? "http://127.0.0.1:8010");

  it("transcribes the Tagalog sample with aligned word timings", async () => {
    const t = await whisperx.transcribe(FIXTURE);
    console.log(`tl: ${t.words.length} words, ${t.estimatedWords ?? 0} estimated`);
    expect(t.language).toBe("tl");
    expect(t.words.length).toBeGreaterThanOrEqual(12);
    t.words.forEach((w, i) => {
      expect(w.endMs).toBeGreaterThanOrEqual(w.startMs);
      if (i) expect(w.startMs).toBeGreaterThanOrEqual(t.words[i - 1].startMs);
    });
    expect(t.estimatedWords ?? 0).toBeLessThanOrEqual(2);
    expect(t.words.map((w) => w.text).join(" ").toLowerCase()).toMatch(/kasi|palengke|bigas/);
  }, SLOW);

  it("falls back to estimated timing for a language without an aligner", async () => {
    const t = await whisperx.transcribe(FIXTURE, { language: "ms" }); // whisperX 3.8.6 has no default Malay aligner
    expect(t.words.length).toBeGreaterThan(0);
    expect(t.estimatedWords).toBe(t.words.length);
  }, SLOW);
});
