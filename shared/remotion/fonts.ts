// Bundled OFL fonts (spec row 15): imported by the composition, so the browser Player and the render browser load the same files.
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/space-grotesk";
import "@fontsource/bebas-neue";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/900.css";
import { continueRender, delayRender } from "remotion";
import { BRAND_FONTS } from "../contract";

// fontsource registers variable fonts as "<Name> Variable".
const CSS_FAMILY: Record<string, string> = {
  Inter: "Inter Variable", Montserrat: "Montserrat Variable", Poppins: "Poppins", "Bebas Neue": "Bebas Neue",
  "Playfair Display": "Playfair Display Variable", "Space Grotesk": "Space Grotesk Variable",
};
export const fontCssFamily = (family: string): string => CSS_FAMILY[family] ?? family;
export const fontStack = (family: string) => `"${fontCssFamily(family)}", system-ui, sans-serif`;

// Hold rendering until every brand font is loaded: a face loads only once text uses it, so ask for each one explicitly.
// Once per page, not per mount: a render attempt React throws away (an MG that throws) must not leak a delayRender handle.
let fontsRequested = false;
export function useFontsReady(): void {
  if (fontsRequested || typeof document === "undefined" || !document.fonts) return;
  fontsRequested = true;
  const handle = delayRender("fonts");
  const loads = BRAND_FONTS.flatMap((f) => [400, 700, 900].map((w) => document.fonts.load(`${w} 64px "${fontCssFamily(f)}"`)));
  Promise.allSettled(loads).then(() => document.fonts.ready).then(() => continueRender(handle));
}
