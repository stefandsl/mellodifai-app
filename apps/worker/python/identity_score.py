"""Identity similarity between a reference image and candidate images or videos.

Embeddings: google/siglip2-base-patch16-224 (Apache-2.0), loaded from --model. Faces: the S3FD
detector of joonson/syncnet_python (MIT). For every candidate the score is the cosine between
L2-normalised SigLIP2 image embeddings of the largest face crop (40% margin), and the same on
the whole image as a fallback when no face is found.

  python identity_score.py --ref performer.png --cand a.png b.mp4 --out identity.json

Videos are sampled at --frames evenly spaced frames; their face score is the mean over the
frames where a face was found, and the minimum is reported too.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import cv2
import numpy as np
import torch
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from faces import DEFAULT_SYNCNET_DIR, detect, square_crop  # noqa: E402

DEFAULT_MODEL = os.environ.get(
    "SIGLIP2_DIR", "G:/caches/models/siglip2-base-patch16-224"
)
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi"}


class Embedder:
    def __init__(self, model_dir: str):
        from transformers import AutoModel, AutoProcessor

        self.processor = AutoProcessor.from_pretrained(model_dir)
        self.model = AutoModel.from_pretrained(model_dir).eval()

    def __call__(self, images_bgr: list[np.ndarray]) -> np.ndarray:
        pil = [Image.fromarray(cv2.cvtColor(i, cv2.COLOR_BGR2RGB)) for i in images_bgr]
        with torch.no_grad():
            inputs = self.processor(images=pil, return_tensors="pt")
            feats = self.model.get_image_features(**inputs)
        feats = torch.nn.functional.normalize(feats, dim=-1)
        return feats.numpy()


def frames_of(path: str, count: int) -> list[np.ndarray]:
    if os.path.splitext(path)[1].lower() not in VIDEO_EXT:
        image = cv2.imread(path)
        if image is None:
            raise SystemExit(f"cannot read {path}")
        return [image]
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    out = []
    for i in range(count):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((i + 0.5) * total / count))
        ok, frame = cap.read()
        if ok:
            out.append(frame)
    cap.release()
    return out


def face_of(image: np.ndarray, syncnet_dir: str):
    boxes = detect(image, syncnet_dir)
    return square_crop(image, boxes[0]) if boxes else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref", required=True)
    parser.add_argument("--cand", nargs="+", required=True)
    parser.add_argument("--frames", type=int, default=8)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--syncnet-dir", default=DEFAULT_SYNCNET_DIR)
    parser.add_argument("--out", required=True)
    a = parser.parse_args()
    embed = Embedder(a.model)
    ref = frames_of(a.ref, 1)[0]
    ref_face = face_of(ref, a.syncnet_dir)
    ref_full = embed([ref])[0]
    ref_face_vec = embed([ref_face])[0] if ref_face is not None else None
    rows = []
    for cand in a.cand:
        frames = frames_of(cand, a.frames)
        full = embed(frames) @ ref_full
        faces = [f for f in (face_of(fr, a.syncnet_dir) for fr in frames) if f is not None]
        face_scores = (
            (embed(faces) @ ref_face_vec).tolist()
            if faces and ref_face_vec is not None
            else []
        )
        rows.append(
            {
                "candidate": os.path.abspath(cand),
                "frames": len(frames),
                "facesFound": len(faces),
                "faceCosine": round(float(np.mean(face_scores)), 4) if face_scores else None,
                "faceCosineMin": round(float(np.min(face_scores)), 4) if face_scores else None,
                "fullCosine": round(float(np.mean(full)), 4),
            }
        )
    report = {
        "model": "google/siglip2-base-patch16-224",
        "ref": os.path.abspath(a.ref),
        "refFaceFound": ref_face is not None,
        "candidates": rows,
    }
    with open(a.out, "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(rows))


if __name__ == "__main__":
    main()
