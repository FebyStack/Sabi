import { anonymousId, readConsent } from "./consent";

// Opt-in funnel events over PostHog's HTTP capture API: no SDK, no cookies, no autocapture or session replay (spec rows 2, 18).
export type AnalyticsEvent = "project_created" | "upload_done" | "captions_done" | "plan_done" | "broll_done" | "render_done" | "export_downloaded";

const key = () => import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = () => import.meta.env.VITE_POSTHOG_HOST as string | undefined;
export const configured = (): boolean => !!(key() && host());

// Sends nothing unless this build has keys and the viewer said yes.
export function track(event: AnalyticsEvent, props: Record<string, string | number> = {}): void {
  if (!configured() || !readConsent()?.analytics) return;
  try {
    void fetch(`${host()!.replace(/\/$/, "")}/capture/`, {
      method: "POST", keepalive: true, headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key(), event, distinct_id: anonymousId(), properties: { ...props, $lib: "sabi" }, timestamp: new Date().toISOString() }),
    }).catch(() => {});
  } catch { /* never let analytics break the app */ }
}
