"""Beats and downbeats with beat_this (CPJKU), on the CPU.

Usage: <stems venv python> -I beats.py <audio.wav> <out.json>
Same tracker and checkpoint as suno-remake tools/beat_this_grid.py. Writes
{"tracker": "beat_this final0", "beats": [...], "downbeats": [...]}.
"""
import json
import sys

from beat_this.inference import File2Beats


def main(audio, out):
    f2b = File2Beats(checkpoint_path="final0", device="cpu", dbn=False)
    beats, downbeats = f2b(audio)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({
            "tracker": "beat_this final0",
            "beats": [round(float(b), 3) for b in beats],
            "downbeats": [round(float(b), 3) for b in downbeats],
        }, f)
    print(f"beats={len(beats)} downbeats={len(downbeats)}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
