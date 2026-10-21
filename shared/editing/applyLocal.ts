import { retimePhrase } from "../captions/retime";
import { carryEmoji, segmentCaptions } from "../captions/segment";
import { getCaptionTemplate } from "../captions/templates";
import { MIN_PHRASE_MS, MIN_SHOT_MS } from "../contract";
import type { Action, Phrase, Project } from "../types";
import { scalePhrase, setEmphasis } from "./phrases";

// The action fold both tiers share: the server's applyActions delegates here, the browser uses it for
// optimistic edits and drag previews. Pure. Actions needing assets or the MG compiler stay on the server.
export type LocalError = { error: "unknown_id" | "no_plan" | "no_captions" | "bad_burn_in" | "out_of_shot" | "out_of_range" | "overlap"; id?: string };
export type LocalResult = { project: Project; rerender: boolean };
export const SERVER_ONLY = new Set<Action["type"]>(["replaceOverlay", "setBrand", "addMotionGraphic"]);

export const isLocalAction = (a: Action) =>
  !SERVER_ONLY.has(a.type) && !(a.type === "updateMotionGraphic" && (a.code !== undefined || a.props !== undefined));

const fail = (error: LocalError["error"], id?: string): LocalError => (id === undefined ? { error } : { error, id });
const omit = <T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> => {
  const { [k]: _gone, ...rest } = o;
  return rest;
};

export function applyLocalAction(project: Project, a: Action): LocalResult | LocalError {
  if (!isLocalAction(a)) throw new Error(`server_only:${a.type}`);
  const p = project;
  const plan = p.editPlan;
  const shots = plan?.shots ?? [];
  const followShots = p.overlays.length > 0; // overlays are drawn only over B-roll shots
  const done = (patch: Partial<Project>, rerender = true): LocalResult => ({ project: { ...p, ...patch }, rerender });
  const phrase = (id: string) => p.phrases.findIndex((x) => x.id === id);
  const withPhrase = (i: number, next: Phrase) => p.phrases.map((x, j) => (j === i ? next : x));

  switch (a.type) {
    case "setTitle": return done({ title: a.title }, false);
    case "setMediaSource": return done({ mediaSource: a.mediaSource }, false);
    case "setCaptionStyle": return done({ captionStyle: a.style });
    case "setTemplate": {
      if (a.captionTemplateId === p.captionTemplateId || !p.phrases.length) return done({ captionTemplateId: a.captionTemplateId });
      // The new layout re-flows the words now, so a still frame shows it before any render.
      const phrases = carryEmoji(p.phrases, segmentCaptions(p.phrases.flatMap((x) => x.words), getCaptionTemplate(a.captionTemplateId).layout));
      return done({ captionTemplateId: a.captionTemplateId, phrases });
    }
    case "setBurnIn":
      if (a.language && !p.translations.some((t) => t.language === a.language)) return fail("bad_burn_in");
      return done({ burnInLanguage: a.language });
    case "setCut": {
      if (!plan) return fail("no_plan");
      if (!plan.cuts.some((c) => c.id === a.cutId)) return fail("unknown_id", a.cutId);
      return done({ editPlan: { ...plan, cuts: plan.cuts.map((c) => (c.id === a.cutId ? { ...c, shouldTrim: a.shouldTrim } : c)) } });
    }
    case "setShotKind": {
      if (!plan) return fail("no_plan");
      if (!shots.some((s) => s.id === a.shotId)) return fail("unknown_id", a.shotId);
      return done({ editPlan: { ...plan, shots: shots.map((s) => (s.id === a.shotId ? { ...s, kind: a.kind } : s)) } }, followShots);
    }
    case "setShotBounds": {
      // Shots stay contiguous: an edge moves the neighbour's matching edge; the first start and last end are fixed.
      if (!plan) return fail("no_plan");
      const i = shots.findIndex((s) => s.id === a.shotId);
      if (i < 0) return fail("unknown_id", a.shotId);
      const s = shots[i], prev = shots[i - 1], next = shots[i + 1];
      const startMs = a.startMs ?? s.startMs, endMs = a.endMs ?? s.endMs;
      const movesFixed = (!prev && startMs !== s.startMs) || (!next && endMs !== s.endMs);
      const tooShort = endMs - startMs < MIN_SHOT_MS || (!!prev && startMs - prev.startMs < MIN_SHOT_MS) || (!!next && next.endMs - endMs < MIN_SHOT_MS);
      if (movesFixed || tooShort) return fail("out_of_range", s.id);
      const moved = shots.map((x, j) => (j === i ? { ...x, startMs, endMs } : j === i - 1 ? { ...x, endMs: startMs } : j === i + 1 ? { ...x, startMs: endMs } : x));
      return done({ editPlan: { ...plan, shots: moved } }, followShots);
    }
    case "editPhrase": {
      if (!p.phrases.length) return fail("no_captions");
      const i = phrase(a.phraseId);
      if (i < 0) return fail("unknown_id", a.phraseId);
      return done({ phrases: withPhrase(i, retimePhrase(p.phrases[i], a.text)) });
    }
    case "retimePhraseRange": {
      if (!p.phrases.length) return fail("no_captions");
      const i = phrase(a.phraseId);
      if (i < 0) return fail("unknown_id", a.phraseId);
      if (a.endMs - a.startMs < MIN_PHRASE_MS) return fail("out_of_range", a.phraseId);
      const prev = p.phrases[i - 1], next = p.phrases[i + 1];
      if ((prev && a.startMs < prev.endMs) || (next && a.endMs > next.startMs)) return fail("overlap", a.phraseId);
      return done({ phrases: withPhrase(i, scalePhrase(p.phrases[i], a.startMs, a.endMs)) });
    }
    case "setWordEmphasis": {
      const i = phrase(a.phraseId);
      if (i < 0) return fail("unknown_id", a.phraseId);
      if (!p.phrases[i].words.some((w) => w.id === a.wordId)) return fail("unknown_id", a.wordId);
      return done({ phrases: withPhrase(i, setEmphasis(p.phrases[i], a.wordId, a.emphasis)) });
    }
    case "setPhraseEmoji": {
      const i = phrase(a.phraseId);
      if (i < 0) return fail("unknown_id", a.phraseId);
      const bare = omit(p.phrases[i], "emoji");
      return done({ phrases: withPhrase(i, a.emoji ? { ...bare, emoji: a.emoji } : bare) });
    }
    case "setOverlay": {
      const o = p.overlays.find((x) => x.id === a.overlayId);
      if (!o) return fail("unknown_id", a.overlayId);
      const startMs = a.startMs ?? o.startMs, endMs = a.endMs ?? o.endMs;
      if (a.startMs !== undefined || a.endMs !== undefined) {
        const shot = shots.find((s) => s.id === o.shotId);
        if (!shot || startMs < shot.startMs || endMs > shot.endMs || endMs <= startMs) return fail("out_of_shot", o.id);
      }
      const next = { ...o, startMs, endMs, enabled: a.enabled ?? o.enabled, placement: a.placement ?? o.placement, transition: a.transition ?? o.transition };
      return done({ overlays: p.overlays.map((x) => (x.id === o.id ? next : x)) });
    }
    case "removeOverlay":
      if (!p.overlays.some((x) => x.id === a.overlayId)) return fail("unknown_id", a.overlayId);
      return done({ overlays: p.overlays.filter((x) => x.id !== a.overlayId) });
    case "removeMotionGraphic":
      if (!p.motionGraphics.some((m) => m.id === a.mgId)) return fail("unknown_id", a.mgId);
      return done({ motionGraphics: p.motionGraphics.filter((m) => m.id !== a.mgId) });
    case "updateMotionGraphic": {
      const m = p.motionGraphics.find((x) => x.id === a.mgId);
      if (!m) return fail("unknown_id", a.mgId);
      const { type: _t, mgId: _id, ...changes } = a;
      const next = { ...m, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) };
      const dur = p.sourceDurationMs;
      if (dur === null || next.endMs <= next.startMs || next.endMs > dur) return fail("out_of_range", m.id);
      return done({ motionGraphics: p.motionGraphics.map((x) => (x.id === m.id ? next : x)) });
    }
    default:
      throw new Error(`server_only:${a.type}`);
  }
}

// Folds in order; each step sees the previous ones. Stops at the first error.
export function applyLocal(project: Project, actions: Action[]): LocalResult | LocalError {
  let cur: LocalResult = { project, rerender: false };
  for (const a of actions) {
    const out = applyLocalAction(cur.project, a);
    if ("error" in out) return out;
    cur = { project: out.project, rerender: cur.rerender || out.rerender };
  }
  return cur;
}
