import { CaptionBlock } from "@shared/remotion/CaptionBlock";
import type { CaptionTemplate, Phrase } from "@shared/types";

const SAMPLE: Phrase = {
  id: "sample", startMs: 0, endMs: 1600, lineBreaksAfter: [],
  words: [
    { id: "s0", text: "Morning", startMs: 0, endMs: 400 }, { id: "s1", text: "routines", startMs: 400, endMs: 800, emphasis: "keyword" },
    { id: "s2", text: "that", startMs: 800, endMs: 1200 }, { id: "s3", text: "stick", startMs: 1200, endMs: 1600 },
  ],
};

// The real caption block at a quarter of the 1080-wide composition, so a preset card looks like the export.
export function CaptionSample({ template }: { template: CaptionTemplate }) {
  return (
    <div aria-hidden className="relative h-[160px] w-[270px] overflow-hidden rounded-2 bg-surface-2">
      <div className="absolute left-0 top-0 h-[640px] w-[1080px] origin-top-left scale-25">
        <CaptionBlock phrase={SAMPLE} template={template} activeIndex={1} height={640} />
      </div>
    </div>
  );
}
