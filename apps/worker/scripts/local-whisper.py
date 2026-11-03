"""Transcribe a take with cached local Whisper weights; write word timestamps as JSON."""
import json
import os
import sys

os.environ["NUMBA_CACHE_DIR"] = "G:/caches/whisper/numba"
import whisper

audio, language, output = sys.argv[1:4]
model = whisper.load_model("base", download_root="G:/caches/whisper")
result = model.transcribe(audio, language=language, word_timestamps=True, fp16=False)
words = [
    {"word": word["word"].strip(), "start": word["start"], "end": word["end"]}
    for segment in result["segments"]
    for word in segment.get("words", [])
    if word["word"].strip()
]
with open(output, "w", encoding="utf-8") as target:
    json.dump(words, target, ensure_ascii=False)
