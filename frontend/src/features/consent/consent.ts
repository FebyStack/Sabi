// The viewer's privacy choice and anonymous id, in localStorage (spec row 18). Storage may be unavailable
// (private mode, blocked site data): every access is wrapped and degrades to "no answer yet" / a per-session id.
export type Consent = { analytics: boolean; at: string };

const CONSENT_KEY = "sabi.consent", AID_KEY = "sabi.aid";
let sessionAid: string | null = null;

const get = (key: string): string | null => { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } };
const set = (key: string, value: string) => { try { globalThis.localStorage?.setItem(key, value); } catch { /* storage unavailable */ } };

export function readConsent(): Consent | null {
  try {
    const c = JSON.parse(get(CONSENT_KEY) ?? "null") as Consent | null;
    return c && typeof c.analytics === "boolean" ? c : null;
  } catch { return null; }
}

export const writeConsent = (c: Consent): void => set(CONSENT_KEY, JSON.stringify(c));

export function anonymousId(): string {
  const stored = get(AID_KEY);
  if (stored) return stored;
  sessionAid ??= crypto.randomUUID(); // kept in memory too, for when storage refuses it
  set(AID_KEY, sessionAid);
  return sessionAid;
}
