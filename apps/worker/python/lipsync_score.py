"""Lip-sync offset and confidence of a sung clip, with SyncNet.

Model and face detector: joonson/syncnet_python (MIT, Joon Son Chung), loaded from
--syncnet-dir. The method follows its run_pipeline.py and SyncNetInstance.evaluate (25 fps
video, 16 kHz audio, face tracks per shot, 224 px crops), rewritten to work on arrays.

  python lipsync_score.py --video draft.mp4 [--audio segment.wav] [--shift-ms 200]
      [--fps 30] --out result.json

--audio replaces the clip's own sound (the gate scores the picture against the song segment,
not against what the model put in its soundtrack). --shift-ms delays the audio for a negative
control. The JSON reports every face track (offset in 25 fps SyncNet steps, in milliseconds and
in frames of --fps, confidence) and their frame-weighted summary.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile

import cv2
import numpy as np
import python_speech_features
import torch
from scipy import signal
from scipy.interpolate import interp1d
from scipy.io import wavfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from faces import DEFAULT_SYNCNET_DIR, detect, syncnet_path  # noqa: E402

SYNC_FPS = 25
VSHIFT = 15
# Sign, measured with --shift-ms on syncnet_python's example clip (offset 3 steps as published):
# delaying the audio by 200 ms moved the offset from 3 to -2, advancing it moved it to 8. So a
# positive offset means the sound runs ahead of the mouth by that much.


def ffmpeg(*args: str) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True
    )


def load_frames(video: str, folder: str) -> list[np.ndarray]:
    ffmpeg(
        "-i",
        video,
        "-vf",
        f"fps={SYNC_FPS},scale=-2:'min(720,ih)'",
        "-q:v",
        "2",
        os.path.join(folder, "%06d.jpg"),
    )
    return [cv2.imread(f) for f in sorted(glob.glob(os.path.join(folder, "*.jpg")))]


def load_audio(source: str, folder: str, shift_ms: float) -> np.ndarray:
    wav = os.path.join(folder, "audio.wav")
    ffmpeg("-i", source, "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", wav)
    rate, audio = wavfile.read(wav)
    assert rate == 16000
    shift = int(round(shift_ms * 16))
    if shift > 0:
        audio = np.concatenate([np.zeros(shift, dtype=audio.dtype), audio])
    elif shift < 0:
        audio = audio[-shift:]
    return audio


def scene_cuts(frames: list[np.ndarray], threshold: float = 0.55) -> list[int]:
    """Frame indexes where a new shot starts (HSV histogram correlation drop)."""
    cuts = [0]
    prev = None
    for i, frame in enumerate(frames):
        hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        if prev is not None and cv2.compareHist(prev, hist, cv2.HISTCMP_CORREL) < threshold:
            cuts.append(i)
        prev = hist
    return cuts


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / area if area > 0 else 0.0


def tracks_in_shot(dets, start, end, min_track, min_face, max_gap=5):
    """Greedy IoU tracking as in run_pipeline.track_shot, with box interpolation."""
    open_tracks: list[list[tuple[int, list[float]]]] = []
    done = []
    for f in range(start, end):
        used = set()
        for track in open_tracks:
            last_f, last_box = track[-1]
            if f - last_f > max_gap:
                continue
            best, best_iou = None, 0.5
            for k, box in enumerate(dets[f]):
                if k in used:
                    continue
                v = iou(last_box, box)
                if v > best_iou:
                    best, best_iou = k, v
            if best is not None:
                used.add(best)
                track.append((f, dets[f][best]))
        for k, box in enumerate(dets[f]):
            if k not in used:
                open_tracks.append([(f, box)])
        still = []
        for track in open_tracks:
            (done if f - track[-1][0] > max_gap else still).append(track)
        open_tracks = still
    done.extend(open_tracks)
    out = []
    for track in done:
        frames = np.array([f for f, _ in track])
        boxes = np.array([b[:4] for _, b in track])
        if frames[-1] - frames[0] + 1 < min_track:
            continue
        size = max(np.mean(boxes[:, 2] - boxes[:, 0]), np.mean(boxes[:, 3] - boxes[:, 1]))
        if size < min_face:
            continue
        full = np.arange(frames[0], frames[-1] + 1)
        interp = np.stack(
            [interp1d(frames, boxes[:, i])(full) for i in range(4)], axis=1
        )
        out.append({"frames": full, "boxes": interp})
    return out


def crop_track(frames, track, crop_scale=0.4):
    """224 px mouth-and-face crops, smoothed as in run_pipeline.crop_video."""
    boxes = track["boxes"]
    s = signal.medfilt(np.maximum(boxes[:, 3] - boxes[:, 1], boxes[:, 2] - boxes[:, 0]) / 2, 13)
    y = signal.medfilt((boxes[:, 1] + boxes[:, 3]) / 2, 13)
    x = signal.medfilt((boxes[:, 0] + boxes[:, 2]) / 2, 13)
    crops = []
    for i, f in enumerate(track["frames"]):
        bs = s[i]
        bsi = int(bs * (1 + 2 * crop_scale))
        padded = np.pad(frames[f], ((bsi, bsi), (bsi, bsi), (0, 0)), "constant", constant_values=110)
        my, mx = y[i] + bsi, x[i] + bsi
        face = padded[
            int(my - bs) : int(my + bs * (1 + 2 * crop_scale)),
            int(mx - bs * (1 + crop_scale)) : int(mx + bs * (1 + crop_scale)),
        ]
        crops.append(cv2.resize(face, (224, 224)))
    return crops


def evaluate(net, crops, audio, batch=20):
    """SyncNetInstance.evaluate on arrays: (offset in 25 fps steps, confidence, min distance)."""
    im = np.stack(crops, axis=3)[None]
    im = np.transpose(im, (0, 3, 4, 1, 2))
    imtv = torch.from_numpy(im.astype(np.float32))
    mfcc = np.stack([np.array(i) for i in zip(*python_speech_features.mfcc(audio, 16000))])
    cct = torch.from_numpy(mfcc[None, None].astype(np.float32))
    length = min(len(crops), len(audio) // 640)
    last = length - 5
    if last < 2 * VSHIFT:
        return None
    im_feat, cc_feat = [], []
    with torch.no_grad():
        for i in range(0, last, batch):
            idx = range(i, min(last, i + batch))
            im_feat.append(net.forward_lip(torch.cat([imtv[:, :, v : v + 5] for v in idx], 0)))
            cc_feat.append(net.forward_aud(torch.cat([cct[:, :, :, v * 4 : v * 4 + 20] for v in idx], 0)))
    im_feat = torch.cat(im_feat, 0)
    cc_feat = torch.cat(cc_feat, 0)
    win = VSHIFT * 2 + 1
    padded = torch.nn.functional.pad(cc_feat, (0, 0, VSHIFT, VSHIFT))
    dists = torch.stack(
        [
            torch.nn.functional.pairwise_distance(im_feat[[i], :].repeat(win, 1), padded[i : i + win, :])
            for i in range(len(im_feat))
        ],
        1,
    )
    mdist = torch.mean(dists, 1)
    minval, minidx = torch.min(mdist, 0)
    offset = VSHIFT - int(minidx)
    conf = float(torch.median(mdist) - minval)
    return offset, conf, float(minval)


def load_net(syncnet_dir: str):
    syncnet_path(syncnet_dir)
    from SyncNetModel import S  # type: ignore

    net = S(num_layers_in_fc_layers=1024)
    state = torch.load(
        os.path.join(syncnet_dir, "data", "syncnet_v2.model"),
        map_location="cpu",
        weights_only=True,
    )
    own = net.state_dict()
    for name, param in state.items():
        key = name.replace("__S__.", "")
        if key in own:
            own[key].copy_(param)
    net.eval()
    return net


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--audio")
    parser.add_argument("--shift-ms", type=float, default=0.0)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--min-track", type=int, default=25)
    parser.add_argument("--min-face", type=int, default=40)
    parser.add_argument("--syncnet-dir", default=DEFAULT_SYNCNET_DIR)
    parser.add_argument("--tmp", default=os.environ.get("TMPDIR"))
    parser.add_argument("--out", required=True)
    a = parser.parse_args()
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    with tempfile.TemporaryDirectory(dir=a.tmp) as folder:
        frames = load_frames(a.video, folder)
        audio = load_audio(a.audio or a.video, folder, a.shift_ms)
    cuts = scene_cuts(frames) + [len(frames)]
    dets = [detect(f, a.syncnet_dir) for f in frames]
    net = load_net(a.syncnet_dir)
    tracks = []
    for start, end in zip(cuts[:-1], cuts[1:]):
        for track in tracks_in_shot(dets, start, end, a.min_track, a.min_face):
            f0, f1 = int(track["frames"][0]), int(track["frames"][-1]) + 1
            clip = audio[f0 * 640 : f1 * 640]
            result = evaluate(net, crop_track(frames, track), clip)
            if result is None:
                continue
            offset, conf, mind = result
            tracks.append(
                {
                    "startS": round(f0 / SYNC_FPS, 3),
                    "endS": round(f1 / SYNC_FPS, 3),
                    "frames25": f1 - f0,
                    "offsetSteps": offset,
                    "offsetMs": offset * 1000 / SYNC_FPS,
                    "offsetFrames": round(offset * a.fps / SYNC_FPS, 3),
                    "confidence": round(conf, 3),
                    "minDist": round(mind, 3),
                }
            )
    total = sum(t["frames25"] for t in tracks)
    summary = None
    if tracks:
        w = np.array([t["frames25"] for t in tracks], dtype=float)
        offs = np.array([t["offsetFrames"] for t in tracks])
        order = np.argsort(offs)
        cum = np.cumsum(w[order])
        median = float(offs[order][np.searchsorted(cum, cum[-1] / 2)])
        summary = {
            "offsetFrames": median,
            "offsetMs": round(median * 1000 / a.fps, 1),
            "confidence": round(float(np.average([t["confidence"] for t in tracks], weights=w)), 3),
            "worstAbsOffsetFrames": float(np.max(np.abs(offs))),
        }
    report = {
        "video": os.path.abspath(a.video),
        "audio": os.path.abspath(a.audio) if a.audio else None,
        "shiftMs": a.shift_ms,
        "fps": a.fps,
        "frames25": len(frames),
        "shots": len(cuts) - 1,
        "faceCoverage": round(total / max(1, len(frames)), 3),
        "tracks": tracks,
        "summary": summary,
    }
    with open(a.out, "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps({"summary": summary, "tracks": len(tracks), "shots": report["shots"]}))


if __name__ == "__main__":
    main()
