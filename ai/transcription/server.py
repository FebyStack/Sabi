"""whisperX sidecar. POST /transcribe (multipart wav, optional language) -> {language, words[{text,start,end,score?}], estimated_words}."""
import logging
import os
import tempfile
from functools import lru_cache

import whisperx
from fastapi import FastAPI, File, Form, UploadFile

from timing import words_from_segments

MODEL = os.environ.get("WHISPERX_MODEL", "small")
DEVICE = os.environ.get("WHISPERX_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPERX_COMPUTE", "int8")

app = FastAPI()


@lru_cache(maxsize=1)
def asr():
    return whisperx.load_model(MODEL, DEVICE, compute_type=COMPUTE)


_aligners: dict = {}


# None when whisperX has no aligner for the language or it can't be downloaded; not cached, so the next request retries.
def aligner(language: str):
    if language not in _aligners:
        try:
            _aligners[language] = whisperx.load_align_model(language_code=language, device=DEVICE)
        except Exception as err:  # ValueError "No default align-model", or a failed download
            logging.warning("no aligner for %s: %s", language, err)
            return None
    return _aligners[language]


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str | None = Form(default=None)):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await file.read())
        path = tmp.name
    try:
        audio = whisperx.load_audio(path)
        result = asr().transcribe(audio, batch_size=8, language=language)
        lang = result.get("language") or language or "en"
        align = aligner(lang) if result.get("segments") else None
        if align:
            model_a, metadata = align
            result = whisperx.align(result["segments"], model_a, metadata, audio, DEVICE, return_char_alignments=False)
        # Unaligned words get timings spread over their segment instead of being dropped.
        words, estimated = words_from_segments(result.get("segments", []))
        return {"language": lang, "words": words, "estimated_words": estimated}
    finally:
        os.unlink(path)
