import { BRAND_FONTS } from "../contract";
import { fontCssFamily } from "./fonts";
import type { FontPayload } from "./mgProtocol";

// The MG sandbox has no network: the page hands it the bundled fonts and the MG's images as bytes (spec row 24).

// The @font-face rules of `families`, each url() swapped for an index into `urls` (absolute, resolved against the sheet).
export function fontFaceCss(rules: { css: string; base: string }[], families: string[]): { css: string; urls: string[] } {
  const urls: string[] = [];
  const kept = rules.filter(({ css }) => {
    const family = /^\s*@font-face[^{]*\{[^}]*font-family:\s*([^;}]+)/.exec(css)?.[1].trim().replace(/^["']|["']$/g, "");
    return family !== undefined && families.includes(family);
  });
  const css = kept.map(({ css, base }) => css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (_, _q: string, raw: string) => {
    urls.push(new URL(raw, base).href);
    return `url(__sabi_font_${urls.length - 1}__)`;
  })).join("\n");
  return { css, urls };
}

let fonts: Promise<FontPayload> | null = null;
// Once per page. A file that can't be read becomes an empty Blob: that face falls back, the MG still draws.
export function fontPayload(): Promise<FontPayload> {
  fonts ??= (async () => {
    const rules: { css: string; base: string }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try { list = sheet.cssRules; } catch { continue; } // another origin's sheet
      for (const r of Array.from(list)) if (r instanceof CSSFontFaceRule) rules.push({ css: r.cssText, base: sheet.href ?? document.baseURI });
    }
    const { css, urls } = fontFaceCss(rules, BRAND_FONTS.map(fontCssFamily));
    const files = await Promise.all(urls.map((u) => fetch(u).then((r) => (r.ok ? r.blob() : new Blob()), () => new Blob())));
    return { css, files };
  })();
  return fonts;
}

const images = new Map<string, Promise<Blob | null>>();
// Each URL fetched once per page; what can't be fetched is listed (the sandbox then refuses it and draws ⚠ image).
export async function imageBlobs(urls: string[]): Promise<{ blobs: [string, Blob][]; failed: string[] }> {
  const got = await Promise.all(urls.map(async (u) => {
    if (!images.has(u)) images.set(u, fetch(u).then((r) => (r.ok ? r.blob() : null), () => null));
    return [u, await images.get(u)!] as const;
  }));
  return { blobs: got.flatMap(([u, b]) => (b ? [[u, b] as [string, Blob]] : [])), failed: got.flatMap(([u, b]) => (b ? [] : [u])) };
}
