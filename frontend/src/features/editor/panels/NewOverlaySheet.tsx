import { useState } from "react";
import { GENERATION_COST_CENTS } from "@shared/contract";
import type { GenerateInput, MediaSource, Overlay } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";

export function newOverlayInput(source: MediaSource, overlay: Overlay, text: string): GenerateInput {
  const t = text.trim();
  return source === "generate"
    ? { source, media: overlay.media, prompt: t, overlayId: overlay.id }
    : { source, media: overlay.media, query: t, overlayId: overlay.id };
}

// New media for one overlay: a fal.ai generation from a prompt, or a Pexels search. The job swaps it in; nothing re-renders.
export function NewOverlaySheet({ mediaSource, overlay, busy, onClose, onGenerate }: {
  mediaSource: MediaSource; overlay: Overlay; busy: boolean; onClose: () => void; onGenerate: (input: GenerateInput) => void;
}) {
  const generate = mediaSource === "generate";
  const [text, setText] = useState(generate ? overlay.prompt : overlay.query);
  const submit = () => {
    if (!text.trim()) return;
    onGenerate(newOverlayInput(mediaSource, overlay, text));
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={generate ? "Generate new media" : "Find new stock"}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={generate ? "Prompt" : "Search Pexels"} hint={generate ? `${GENERATION_COST_CENTS[overlay.media]} ¢ on fal.ai` : undefined}>
          <input className="min-h-11 rounded-2 bg-surface-2 px-3 text-base text-ink" value={text} maxLength={generate ? 600 : 200} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !text.trim()}>{generate ? "Generate" : "Search"}</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Sheet>
  );
}
