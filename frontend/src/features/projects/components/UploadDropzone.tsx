import { useState } from "react";
import { UPLOAD_LIMITS } from "@shared/contract";
import type { Asset } from "@shared/types";
import { track } from "@/features/consent/analytics";
import { uploadFile } from "../api/projects";

// Reports its progress upward (onProgress), so the editor shows "Uploading" in the same stepper as every job.
export function UploadDropzone({ projectId, onUploaded, onProgress }: { projectId: string; onUploaded: (asset: Asset) => void; onProgress?: (pct: number | null) => void }) {
  const [pct, setPctState] = useState<number | null>(null);
  const setPct = (v: number | null) => { setPctState(v); onProgress?.(v); };
  const [error, setError] = useState<string | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    if (!(UPLOAD_LIMITS.mimeTypes as readonly string[]).includes(file.type)) return setError("Use an MP4, MOV, MP3 or WAV file.");
    if (file.size > UPLOAD_LIMITS.maxBytes) return setError("File is over 2 GB.");
    setError(null); setPct(0);
    try { const asset = await uploadFile(file, setPct, projectId); track("upload_done"); onUploaded(asset); } catch (e) { setError((e as Error).message); } finally { setPct(null); }
  };

  return (
    <label
      className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-700 p-4 text-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void handle(e.dataTransfer.files[0]); }}
    >
      <input type="file" className="sr-only" accept={UPLOAD_LIMITS.mimeTypes.join(",")} onChange={(e) => void handle(e.target.files?.[0])} />
      {pct === null ? <span>Drop a video here or tap to choose</span> : <span>Uploading… {pct}%</span>}
      <span className="mt-1 text-xs text-neutral-400">MP4 / MOV / MP3 / WAV · up to 2 GB · up to 10 min</span>
      {error && <span className="mt-2 text-sm text-red-400">{error}</span>}
    </label>
  );
}
