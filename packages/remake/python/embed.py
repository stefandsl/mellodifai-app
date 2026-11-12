"""LaBSE sentence embeddings on the CPU, as a small line-protocol server.

Usage: <labse venv python> -I embed.py
Reads one JSON object per stdin line, {"texts": [...]}, and answers one JSON line,
{"vectors": [[...], ...]} (L2-normalised). Prints "ready" on stderr once the model is loaded.
Model: sentence-transformers/LaBSE (Apache 2.0), as master design 10.3 requires.
"""
import json
import sys

from sentence_transformers import SentenceTransformer


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    model = SentenceTransformer("sentence-transformers/LaBSE", device="cpu")
    print("ready", file=sys.stderr, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            texts = json.loads(line)["texts"]
            vectors = model.encode(texts, normalize_embeddings=True, batch_size=32) if texts else []
            out = {"vectors": [[round(float(x), 6) for x in v] for v in vectors]}
        except Exception as error:  # report, keep serving
            out = {"error": str(error)}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
