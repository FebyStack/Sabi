// Tagalog / Taglish language rules, gated on the project's language so other languages keep today's behaviour.
export const isTagalog = (language?: string | null) => language === "tl" || language === "fil";

// Lower-case, letters only: "'yung" → "yung", "Ano..." → "ano".
export const normWord = (text: string) => text.toLowerCase().replace(/[^\p{L}]/gu, "");

// Real words that are fillers only in hesitation position (set off by pauses).
export const TL_HESITATION = new Set(["ano", "kasi", "parang", "yung", "ganun", "ganon", "eh", "like"]);

// Markers that must start a line together with the word they govern.
export const TL_NO_STRAND = new Set(["ang", "ng", "nang", "sa", "mga", "at", "o", "kay", "ni", "si", "nina", "kung", "para", "pero", "dahil", "yung", "ay"]);

// Never emphasised.
export const TL_FUNCTION_WORDS = new Set([...TL_NO_STRAND, ...TL_HESITATION, "na", "po", "ho", "ba", "pa", "din", "rin", "lang", "naman", "daw", "raw"]);
