"""Pure word-timing helpers for the sidecar (no whisperx import, so pytest runs without the venv)."""


def spread_words(text: str, start: float, end: float) -> list[dict]:
    """Split text into words spread over [start, end], each lasting in proportion to its length. No score: estimated."""
    words = text.split()
    total = sum(len(w) for w in words)
    out, done = [], 0
    for w in words:
        a = start + (end - start) * done / total
        done += len(w)
        out.append({"text": w, "start": round(a, 3), "end": round(start + (end - start) * done / total, 3)})
    return out


def words_from_segments(segments: list[dict]) -> tuple[list[dict], int]:
    """whisperX segments (aligned or not) -> sidecar words, never dropping one. Returns (words, estimated count).

    A run of words without timing is spread between its timed neighbours (the segment's start/end at the edges).
    A segment with no words (no aligner, or alignment failed and whisperX returned "words": []) is one such run.
    Only words of a segment with no aligned word at all count as estimated: a number pinned between aligned
    neighbours lands close enough that warning about it would be noise."""
    words, estimated = [], 0
    for seg in segments:
        items = seg.get("words") or [{"word": t} for t in seg.get("text", "").split()]
        pending, at, first, timed = [], float(seg["start"]), len(words), False

        def flush(until: float):
            words.extend(spread_words(" ".join(pending), at, max(until, at)))
            pending.clear()

        for w in items:
            text = w["word"].strip()
            if not text:
                continue
            if "start" in w and "end" in w:
                if pending:
                    flush(float(w["start"]))
                words.append({"text": text, "start": float(w["start"]), "end": float(w["end"]), "score": float(w.get("score", 0))})
                at, timed = float(w["end"]), True
            else:
                pending.append(text)
        if pending:
            flush(float(seg["end"]))
        if not timed:
            estimated += len(words) - first
    return words, estimated
