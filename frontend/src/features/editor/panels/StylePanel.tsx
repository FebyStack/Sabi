import { useEffect, useState } from "react";
import { CAPTION_TEMPLATES } from "@shared/captions/templates";
import { BRAND_FONTS } from "@shared/contract";
import { brandedTemplate, effectiveTemplate, templateLook } from "@shared/editing/brand";
import { CAPTION_MIN_CONTRAST, contrastRatio } from "@shared/editing/contrast";
import type { Action, BrandFont, BrandKit, CaptionStyle, Project } from "@shared/types";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { assetFileUrl, uploadFile } from "@/features/projects/api/projects";
import { useDebouncedCommit } from "@/hooks/useDebouncedCommit";
import { CaptionSample } from "./CaptionSample";

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PALETTE: { key: keyof BrandKit["palette"]; label: string }[] = [
  { key: "primary", label: "Primary" }, { key: "accent", label: "Accent" }, { key: "text", label: "Text" }, { key: "background", label: "Background" },
];
const control = "min-h-11 w-full rounded-2 bg-surface-2 px-3";
const isBrandFont = (f: string): f is BrandFont => (BRAND_FONTS as readonly string[]).includes(f);

type Props = { project: Project; commit: (actions: Action[]) => Promise<void>; busy: boolean };

// Preset → caption style → brand kit. Every change commits the whole style (or kit) object; ranges and colours are debounced.
export function StylePanel({ project, commit, busy }: Props) {
  const debounced = useDebouncedCommit(commit);
  const t = effectiveTemplate(project);
  // Ranges and colours move locally at once; the debounced commit catches up.
  const [draftStyle, setDraftStyle] = useState<CaptionStyle>(project.captionStyle ?? {});
  const [draftBrand, setDraftBrand] = useState<BrandKit | null>(project.brand);
  const [logoError, setLogoError] = useState<string | null>(null);
  useEffect(() => setDraftStyle(project.captionStyle ?? {}), [project.captionStyle]);
  useEffect(() => setDraftBrand(project.brand), [project.brand]);

  const setStyle = (patch: CaptionStyle, slow = false) => {
    const next = { ...draftStyle, ...patch }; // the draft, so a pending debounced range survives the next toggle
    setDraftStyle(next);
    (slow ? debounced : commit)([{ type: "setCaptionStyle", style: next }]);
  };
  const setBrand = (brand: BrandKit | null, slow = false) => {
    setDraftBrand(brand);
    (slow ? debounced : commit)([{ type: "setBrand", brand }]);
  };
  const look = templateLook(t);
  const fromPreset = (): BrandKit => ({
    palette: { primary: look.primary, accent: look.accent, text: look.text, background: look.background },
    fontFamily: isBrandFont(look.fontFamily) ? look.fontFamily : "Inter", logoAssetId: null, grade: 0,
  });
  const uploadLogo = async (file: File | undefined) => {
    if (!file || !project.brand) return;
    if (!LOGO_TYPES.includes(file.type)) return setLogoError("Use a PNG, JPEG or WebP logo.");
    setLogoError(null);
    try {
      const asset = await uploadFile(file, () => {}, project.id);
      await commit([{ type: "setBrand", brand: { ...project.brand, logoAssetId: asset.id } }]);
    } catch (e) { setLogoError(`Upload failed: ${(e as Error).message}`); }
  };
  const ratio = contrastRatio(t.colors.text, project.brand?.palette.background ?? "#000000");
  const size = draftStyle.sizePx ?? t.font.sizePx, y = draftStyle.y ?? t.position.y;

  return (
    <section className="space-y-6">
      {ratio < CAPTION_MIN_CONTRAST && <Notice tone="warn">Caption text is hard to read on this background ({ratio.toFixed(1)}:1)</Notice>}

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-ink-muted">Presets</h2>
        <div role="radiogroup" aria-label="Caption preset" className="flex gap-2 overflow-x-auto pb-1">
          {CAPTION_TEMPLATES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === project.captionTemplateId} aria-label={`Preset ${p.name}`} disabled={busy}
              onClick={() => p.id !== project.captionTemplateId && commit([{ type: "setTemplate", captionTemplateId: p.id as Project["captionTemplateId"] }])}
              className={`shrink-0 space-y-1 rounded-3 p-1 text-left text-sm ${p.id === project.captionTemplateId ? "ring-2 ring-accent" : ""}`}>
              <CaptionSample template={brandedTemplate(p, project.brand)} />
              <span className="block px-1">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-ink-muted">Caption style</h2>
        <CaptionSample template={effectiveTemplate({ ...project, captionStyle: draftStyle })} />
        <Field label="Font">
          <select className={control} disabled={busy} value={draftStyle.fontFamily ?? ""} onChange={(e) => setStyle({ fontFamily: (e.target.value || undefined) as BrandFont | undefined })}>
            <option value="">Preset default</option>
            {BRAND_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label={`Size ${size} px`}>
          <input type="range" aria-label="Caption size" min={40} max={120} step={4} value={size} disabled={busy} onChange={(e) => setStyle({ sizePx: Number(e.target.value) }, true)} className="min-h-11 w-full accent-accent" />
        </Field>
        <Field label={`Position ${Math.round(y * 100)}% from the top`}>
          <input type="range" aria-label="Caption position" min={0.5} max={0.9} step={0.02} value={y} disabled={busy} onChange={(e) => setStyle({ y: Number(e.target.value) }, true)} className="min-h-11 w-full accent-accent" />
        </Field>
        <Segmented<"400" | "700" | "900"> label="Weight" value={String(draftStyle.weight ?? t.font.weight) as "400" | "700" | "900"} disabled={busy}
          options={[{ value: "400", label: "Regular" }, { value: "700", label: "Bold" }, { value: "900", label: "Black" }]}
          onChange={(w) => setStyle({ weight: Number(w) as 400 | 700 | 900 })} />
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="flex items-center gap-1"><Switch label="Uppercase" checked={draftStyle.uppercase ?? t.uppercase} disabled={busy} onChange={(on) => setStyle({ uppercase: on })} />Uppercase</span>
          <span className="flex items-center gap-1"><Switch label="Background box" checked={draftStyle.background ?? !!t.colors.background} disabled={busy} onChange={(on) => setStyle({ background: on })} />Background box</span>
        </div>
        <Segmented<"karaoke" | "none"> label="Animation" value={draftStyle.animation ?? t.animation} disabled={busy}
          options={[{ value: "karaoke", label: "Karaoke" }, { value: "none", label: "None" }]} onChange={(animation) => setStyle({ animation })} />
        <Button size="sm" disabled={busy || !project.captionStyle} onClick={() => commit([{ type: "setCaptionStyle", style: null }])}>Reset style</Button>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-ink-muted">Brand kit</h2>
        {!draftBrand ? (
          <>
            <p className="text-sm text-ink-muted">A brand kit recolours captions and motion graphics and grades the footage.</p>
            <Button variant="primary" disabled={busy} onClick={() => setBrand(fromPreset())}>Use brand</Button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {PALETTE.map(({ key, label }) => (
                <label key={key} className="flex flex-col items-center gap-1 text-xs text-ink-muted">
                  <input type="color" aria-label={label} value={draftBrand.palette[key].toLowerCase()} disabled={busy}
                    onChange={(e) => setBrand({ ...draftBrand, palette: { ...draftBrand.palette, [key]: e.target.value.toUpperCase() } }, true)}
                    className="h-11 w-full min-w-11 cursor-pointer rounded-2 bg-transparent" />
                  {label}
                </label>
              ))}
            </div>
            <Field label="Brand font">
              <select className={control} disabled={busy} value={draftBrand.fontFamily} onChange={(e) => setBrand({ ...draftBrand, fontFamily: e.target.value as BrandFont })}>
                {BRAND_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              {draftBrand.logoAssetId && <img src={assetFileUrl(draftBrand.logoAssetId)} alt="Logo" className="size-11 rounded-2 bg-surface-2 object-contain" />}
              <label className={`grid min-h-11 place-items-center rounded-2 bg-surface-2 px-3 text-sm ${busy ? "pointer-events-none opacity-40" : "cursor-pointer"}`}>
                Upload logo
                <input type="file" accept={LOGO_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(e) => uploadLogo(e.target.files?.[0])} />
              </label>
              {draftBrand.logoAssetId && <Button size="sm" disabled={busy} onClick={() => setBrand({ ...draftBrand, logoAssetId: null })}>Remove logo</Button>}
            </div>
            {logoError && <Notice tone="error">{logoError}</Notice>}
            <Field label={`Footage grade ${Math.round(draftBrand.grade * 100)}%`}>
              <input type="range" aria-label="Footage grade" min={0} max={1} step={0.05} value={draftBrand.grade} disabled={busy}
                onChange={(e) => setBrand({ ...draftBrand, grade: Number(e.target.value) }, true)} className="min-h-11 w-full accent-accent" />
            </Field>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setBrand(null)}>Remove brand</Button>
          </>
        )}
      </div>
    </section>
  );
}
