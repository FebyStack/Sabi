import { deriveBeats } from "./beats";
import type { Shot, ShotKind } from "../types";
import { SHOT_KINDS } from "../contract";

const shot = (i: number, kind: ShotKind, startMs: number, endMs: number): Shot => ({ id: `shot-${i}`, kind, startMs, endMs });

describe("deriveBeats", () => {
  it("one beat per b-roll shot with 300 ms lead and 5 s cap", () => {
    const shots = [shot(0, "Hook", 0, 4000), shot(1, "B-Roll", 4000, 12000), shot(2, "Talking Head", 12000, 15000), shot(3, "Talking Head & B-Roll", 15000, 21000)];
    expect(deriveBeats(shots, { allowVideo: true })).toEqual([
      { id: "beat-0", shotId: "shot-1", startMs: 4300, endMs: 9300, placement: "full", media: "image" },
      { id: "beat-1", shotId: "shot-3", startMs: 15300, endMs: 20300, placement: "top", media: "image" },
    ]);
  });

  it("drops beats shorter than 1.5 s", () => {
    expect(deriveBeats([shot(0, "Hook", 0, 4000), shot(1, "B-Roll", 4000, 5600)], { allowVideo: false })).toEqual([]);
    expect(deriveBeats([shot(0, "B-Roll", 0, 1800)], { allowVideo: false })).toHaveLength(1); // exactly 1500 ms is kept
  });

  it("beats never overlap", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 20; run++) {
      let at = 0;
      const shots = Array.from({ length: 2 + Math.floor(rand() * 10) }, (_, i) => {
        const len = 200 + Math.floor(rand() * 9000);
        const s = shot(i, SHOT_KINDS[Math.floor(rand() * SHOT_KINDS.length)], at, at + len);
        at += len;
        return s;
      });
      const beats = deriveBeats(shots, { allowVideo: false });
      beats.forEach((b, i) => {
        const s = shots.find((x) => x.id === b.shotId)!;
        expect(b.startMs).toBeGreaterThanOrEqual(s.startMs);
        expect(b.endMs).toBeLessThanOrEqual(s.endMs);
        expect(b.endMs - b.startMs).toBeGreaterThanOrEqual(1500);
        if (i) expect(b.startMs).toBeGreaterThanOrEqual(beats[i - 1].endMs);
      });
    }
  });
});
