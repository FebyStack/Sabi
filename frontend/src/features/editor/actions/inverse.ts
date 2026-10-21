import { applyLocalAction, isLocalAction } from "@shared/editing/applyLocal";
import type { Action, Project } from "@shared/types";

const pick = <T extends object>(from: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, from[k as keyof T]]));
const given = (a: object, skip: string[]) => Object.entries(a).filter(([k, v]) => v !== undefined && !skip.includes(k)).map(([k]) => k);

// The inverse of one action, read from the state just before it; null when it cannot be undone.
function inverseOf(p: Project, a: Action): Action | null {
  switch (a.type) {
    case "setTitle": return { type: "setTitle", title: p.title };
    case "setMediaSource": return { type: "setMediaSource", mediaSource: p.mediaSource };
    case "setTemplate": return { type: "setTemplate", captionTemplateId: p.captionTemplateId };
    case "setBurnIn": return { type: "setBurnIn", language: p.burnInLanguage };
    case "setCaptionStyle": return { type: "setCaptionStyle", style: p.captionStyle };
    case "setBrand": return { type: "setBrand", brand: p.brand };
    case "setCut": {
      const c = p.editPlan?.cuts.find((x) => x.id === a.cutId);
      return c ? { type: "setCut", cutId: c.id, shouldTrim: c.shouldTrim } : null;
    }
    case "setShotKind": {
      const s = p.editPlan?.shots.find((x) => x.id === a.shotId);
      return s ? { type: "setShotKind", shotId: s.id, kind: s.kind } : null;
    }
    case "setShotBounds": {
      const s = p.editPlan?.shots.find((x) => x.id === a.shotId);
      return s ? { type: "setShotBounds", shotId: s.id, ...pick(s, given(a, ["type", "shotId"])) } : null;
    }
    case "setOverlay": {
      const o = p.overlays.find((x) => x.id === a.overlayId);
      return o ? { type: "setOverlay", overlayId: o.id, ...pick(o, given(a, ["type", "overlayId"])) } : null;
    }
    case "updateMotionGraphic": {
      const m = p.motionGraphics.find((x) => x.id === a.mgId);
      if (!m || a.code !== undefined) return null; // code needs the server compiler; the web never sends it
      return { type: "updateMotionGraphic", mgId: m.id, ...pick(m, given(a, ["type", "mgId"])) };
    }
    case "editPhrase": {
      const ph = p.phrases.find((x) => x.id === a.phraseId);
      return ph ? { type: "editPhrase", phraseId: ph.id, text: ph.words.map((w) => w.text).join(" ") } : null;
    }
    case "retimePhraseRange": {
      const ph = p.phrases.find((x) => x.id === a.phraseId);
      return ph ? { type: "retimePhraseRange", phraseId: ph.id, startMs: ph.startMs, endMs: ph.endMs } : null;
    }
    case "setWordEmphasis": {
      const w = p.phrases.find((x) => x.id === a.phraseId)?.words.find((x) => x.id === a.wordId);
      return w ? { type: "setWordEmphasis", phraseId: a.phraseId, wordId: w.id, emphasis: w.emphasis ?? null } : null;
    }
    case "setPhraseEmoji": {
      const ph = p.phrases.find((x) => x.id === a.phraseId);
      return ph ? { type: "setPhraseEmoji", phraseId: ph.id, emoji: ph.emoji ?? null } : null;
    }
    default: return null; // removeOverlay, replaceOverlay, addMotionGraphic, removeMotionGraphic: the panels ask "Delete?" instead
  }
}

// Exact inverses from the pre-state, in reverse order; null as soon as one action is not undoable.
export function inverseActions(project: Project, actions: Action[]): Action[] | null {
  const out: Action[] = [];
  let cur = project;
  for (const a of actions) {
    const inv = inverseOf(cur, a);
    if (!inv) return null;
    out.unshift(inv);
    if (a.type === "setBrand") cur = { ...cur, brand: a.brand };
    else if (isLocalAction(a)) {
      const next = applyLocalAction(cur, a);
      if ("error" in next) return null;
      cur = next.project;
    }
  }
  return out;
}
