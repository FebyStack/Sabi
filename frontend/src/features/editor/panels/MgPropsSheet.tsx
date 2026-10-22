import { useEffect, useState } from "react";
import type { Action, MotionGraphic } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import { Switch } from "@/components/ui/Switch";
import { assetFileUrl, uploadFile } from "@/features/projects/api/projects";
import { useDebouncedCommit } from "@/hooks/useDebouncedCommit";

type Prop = MotionGraphic["props"][number];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const control = "min-h-11 w-full rounded-2 bg-surface-2 px-3";

// "unitLabel" → "Unit label"
export const propLabel = (key: string) => {
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
};

// Numbers keep what is typed ("1.", "-") until it parses; the MG gets each valid value.
function NumberInput({ name, value, disabled, onValue }: { name: string; value: number; disabled: boolean; onValue: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input name={name} type="number" step="any" inputMode="decimal" className={control} value={text} disabled={disabled}
      onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() && Number.isFinite(n)) onValue(n); }} />
  );
}

// The web edits an MG's props (spec row 25); its code stays the agent's. Every change commits the whole props array;
// text, numbers and colours after 300 ms.
export function MgPropsSheet({ mg, projectId, busy, commit, onClose }:
  { mg: MotionGraphic; projectId: string; busy: boolean; commit: (actions: Action[]) => Promise<void>; onClose: () => void }) {
  const debounced = useDebouncedCommit(commit);
  const [draft, setDraft] = useState<Prop[]>(mg.props);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(mg.props), [mg.props]);

  const set = (key: string, value: Prop["value"], slow = false) => {
    const next = draft.map((p) => (p.key === key ? { ...p, value } : p)) as Prop[]; // the draft, so a pending edit survives the next
    setDraft(next);
    const actions: Action[] = [{ type: "updateMotionGraphic", mgId: mg.id, props: next }];
    if (slow) debounced(actions);
    else return commit(actions);
  };
  const upload = async (key: string, file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setError("Use a PNG, JPEG or WebP image.");
    setError(null);
    try {
      const asset = await uploadFile(file, () => {}, projectId);
      await set(key, asset.id);
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    }
  };

  return (
    <Sheet open onClose={onClose} title={`Edit ${mg.name}`}>
      <div className="space-y-3">
        {draft.map((p) => {
          const label = propLabel(p.key);
          switch (p.type) {
            case "text":
              return <Field key={p.key} label={label}><input name={p.key} className={control} value={p.value} maxLength={500} disabled={busy} onChange={(e) => set(p.key, e.target.value, true)} /></Field>;
            case "number":
              return <Field key={p.key} label={label}><NumberInput name={p.key} value={p.value} disabled={busy} onValue={(n) => set(p.key, n, true)} /></Field>;
            case "color":
              return <Field key={p.key} label={label}><input name={p.key} type="color" className="h-11 w-16 rounded-2 bg-surface-2" value={p.value.toLowerCase()} disabled={busy} onChange={(e) => set(p.key, e.target.value, true)} /></Field>;
            case "boolean":
              return <div key={p.key} className="flex items-center justify-between text-sm"><span className="text-ink-muted">{label}</span><Switch label={label} checked={p.value} disabled={busy} onChange={(on) => void set(p.key, on)} /></div>;
            case "image":
              return (
                <div key={p.key} className="flex items-center gap-3 text-sm">
                  <img src={assetFileUrl(p.value)} alt="" className="size-16 shrink-0 rounded-2 bg-black object-cover" />
                  <span className="flex-1 text-ink-muted">{label}</span>
                  <label className={`grid min-h-11 place-items-center rounded-2 bg-surface-2 px-3 ${busy ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
                    Replace
                    <input name={p.key} type="file" accept={IMAGE_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => upload(p.key, e.target.files?.[0])} />
                  </label>
                </div>
              );
          }
        })}
        {error && <Notice tone="error">{error}</Notice>}
        <Button onClick={onClose}>Done</Button>
      </div>
    </Sheet>
  );
}
