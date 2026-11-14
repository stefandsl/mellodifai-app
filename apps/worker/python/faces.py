"""Face detection shared by the music-video gates.

Uses the S3FD detector shipped with joonson/syncnet_python (MIT), loaded from the folder given
by --syncnet-dir (default G:/caches/models/syncnet_python). Nothing here downloads anything.
"""

from __future__ import annotations

import os
import sys

import cv2
import numpy as np

DEFAULT_SYNCNET_DIR = os.environ.get(
    "SYNCNET_DIR", "G:/caches/models/syncnet_python"
)

_detector = None


def syncnet_path(syncnet_dir: str) -> None:
    if syncnet_dir not in sys.path:
        sys.path.insert(0, syncnet_dir)


def detector(syncnet_dir: str):
    global _detector
    if _detector is None:
        syncnet_path(syncnet_dir)
        cwd = os.getcwd()
        # The S3FD module loads its weights by a path relative to the repository.
        os.chdir(syncnet_dir)
        try:
            from detectors import S3FD  # type: ignore

            _detector = S3FD(device="cpu")
        finally:
            os.chdir(cwd)
    return _detector


def detect(image_bgr: np.ndarray, syncnet_dir: str, conf: float = 0.9):
    """Boxes [x1, y1, x2, y2, score] in the image's pixels, largest first.

    The detector runs on a copy scaled to about 360 px high, as the original pipeline runs it
    on a quarter-size frame.
    """
    height = image_bgr.shape[0]
    scale = min(1.0, 360.0 / max(1, height))
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    boxes = detector(syncnet_dir).detect_faces(rgb, conf_th=conf, scales=[scale])
    out = [list(map(float, b)) for b in boxes]
    out.sort(key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
    return out


def square_crop(image_bgr: np.ndarray, box, margin: float = 0.4) -> np.ndarray:
    """A square crop around a face box with `margin` of the box size on every side."""
    x1, y1, x2, y2 = box[:4]
    side = max(x2 - x1, y2 - y1) * (1 + 2 * margin)
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    half = side / 2
    pad = int(half) + 1
    padded = np.pad(
        image_bgr, ((pad, pad), (pad, pad), (0, 0)), "constant", constant_values=110
    )
    top = int(cy - half) + pad
    left = int(cx - half) + pad
    return padded[top : top + int(side), left : left + int(side)]
