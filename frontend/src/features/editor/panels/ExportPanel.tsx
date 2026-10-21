import { useState } from "react";
import type { Project, RenderInput } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Segmented } from "@/components/ui/Segmented";
import { assetFileUrl } from "@/features/projects/api/projects";

type Resolution = "1080p" | "4k";
export type DownloadKind = "mp4" | "srt" | "vtt";
type Props = { project: Project; busy: boolean; onRender: (input: RenderInput) => void; onDownload: (kind: DownloadKind) => void };

// The only place a web edit becomes an MP4 (spec row 14): 1080p or 4K (Remotion scale 2).
export function ExportPanel({ project: p, busy, onRender, onDownload }: Props) {
  const [resolution, setResolution] = useState<Resolution>(p.outputs.resolution ?? "1080p");
  const link = "grid min-h-11 place-items-center rounded-2 bg-surface-2 px-4 text-sm";
  const file = (assetId: string, name: string, label: string, kind: DownloadKind) => (
    <a key={assetId} className={link} href={assetFileUrl(assetId)} download={name} onClick={() => onDownload(kind)}>{label}</a>
  );

  return (
    <section className="space-y-4">
      <Segmented<Resolution> label="Resolution" value={resolution} disabled={busy} onChange={setResolution}
        options={[{ value: "1080p", label: "1080p" }, { value: "4k", label: "4K" }]} />
      <Button variant="primary" disabled={busy || !p.phrases.length} onClick={() => onRender({ scale: resolution === "4k" ? 2 : 1 })}>Render</Button>
      {p.outputs.stale && <Notice tone="warn">Edits since the last render — render again to export them</Notice>}
      {p.outputs.mp4AssetId ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-muted">Rendered at {p.outputs.resolution === "4k" ? "4K" : "1080p"}</p>
          <div className="flex flex-wrap gap-2">
            {file(p.outputs.mp4AssetId, `${p.title}.mp4`, "Download MP4", "mp4")}
            {p.outputs.srtAssetId && file(p.outputs.srtAssetId, `${p.title}.srt`, "SRT", "srt")}
            {p.outputs.vttAssetId && file(p.outputs.vttAssetId, `${p.title}.vtt`, "VTT", "vtt")}
            {p.outputs.translations?.flatMap((t) => [
              file(t.srtAssetId, `${p.title}.${t.language}.srt`, `SRT (${t.language})`, "srt"),
              file(t.vttAssetId, `${p.title}.${t.language}.vtt`, `VTT (${t.language})`, "vtt"),
            ])}
          </div>
        </div>
      ) : <p className="text-sm text-ink-muted">Render to create the MP4 and subtitles.</p>}
    </section>
  );
}
