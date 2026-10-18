"""whisperX sidecar. POST /transcribe (multipart wav, optional language) -> {language, words[{text,start,end,score}]}."""
import os
import tempfile
from functools import lru_cache

import whisperx
from fastapi import FastAPI, File, Form, UploadFile

MODEL = os.environ.get("WHISPERX_MODEL", "small")
DEVICE = os.environ.get("WHISPERX_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPERX_COMPUTE", "int8")

app = FastAPI()


@lru_cache(maxsize=1)
def asr():
    return whisperx.load_model(MODEL, DEVICE, compute_type=COMPUTE)


@lru_cache(maxsize=8)
def aligner(language: str):
    return whisperx.load_align_model(language_code=language, device=DEVICE)


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
        if result.get("segments"):
            model_a, metadata = aligner(lang)
            result = whisperx.align(result["segments"], model_a, metadata, audio, DEVICE, return_char_alignments=False)
        words = [
            {"text": w["word"].strip(), "start": float(w["start"]), "end": float(w["end"]), "score": float(w.get("score", 0))}
            for seg in result.get("segments", [])
            for w in seg.get("words", [])
            if "start" in w and "end" in w and w["word"].strip()
        ]
        return {"language": lang, "words": words}
    finally:
        os.unlink(path)
