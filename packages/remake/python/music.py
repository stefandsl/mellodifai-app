"""Structure, meter, energy and vocal measurements of a song, for the remake analysis.

Usage: python -I music.py <audio.wav> <out.json> [--beats beats.json] [--stems DIR]

- beats: from beats.py (beat_this) when given, else librosa's tracker with a downbeat phase
  chosen from low-band onsets (the method of suno-remake tools/beat_grid.py);
- meter: beats per bar (median beats between downbeats) and how regular it is;
- boundaries + labels: checkerboard novelty on a beat-synchronous chroma+MFCC self-similarity
  matrix, then segments that sound alike share a letter (A, B, C...);
- energy: RMS per second, 0-1 on the 5th-95th percentile (as beat_grid.py does per frame);
- vocal and stem shares: from Demucs stems (vocals/drums/bass/other.wav) when given.
Prints one summary line; writes JSON.
"""
import argparse
import json
import string
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 512


def beats_librosa(y, sr):
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=HOP, tightness=400)
    beats = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
    # Downbeat phase and meter: which beat in a bar of 3 or 4 carries the most low-band onset energy.
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    low = S[freqs < 150].sum(axis=0)
    low_env = np.maximum(0, np.diff(low, prepend=low[0]))
    strength = low_env[np.clip(frames, 0, len(low_env) - 1)] if len(frames) else np.array([])
    best = (4, 0, 0.0)
    for n in (4, 3):
        for phase in range(n):
            on = strength[phase::n]
            if len(on) < 4:
                continue
            contrast = float(on.mean() / (strength.mean() + 1e-9))
            if contrast > best[2] + (0.05 if n == 3 else 0):
                best = (n, phase, contrast)
    n, phase, _ = best
    return beats, beats[phase::n], "librosa"


def meter(beats, downbeats):
    if len(downbeats) < 3:
        return 4, 0.3
    counts = [int(((beats >= a) & (beats < b)).sum()) for a, b in zip(downbeats[:-1], downbeats[1:])]
    counts = [c for c in counts if c > 0]
    if not counts:
        return 4, 0.3
    values, freq = np.unique(counts, return_counts=True)
    n = int(values[np.argmax(freq)])
    return max(2, min(12, n)), round(float(freq.max() / len(counts)), 3)


def segment(y, sr, beats, beats_per_bar, duration):
    frames = librosa.time_to_frames(beats, sr=sr, hop_length=HOP)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=HOP)
    feats = np.vstack([chroma, mfcc])
    sync = librosa.util.sync(feats, frames, aggregate=np.median)
    sync = (sync - sync.mean(axis=1, keepdims=True)) / (sync.std(axis=1, keepdims=True) + 1e-9)
    norm = sync / (np.linalg.norm(sync, axis=0, keepdims=True) + 1e-9)
    ssm = norm.T @ norm
    n = ssm.shape[0]
    times = np.concatenate([[0.0], beats]) if len(beats) and beats[0] > 0 else np.asarray(beats)
    times = times[:n] if len(times) >= n else np.pad(times, (0, n - len(times)), mode="edge")
    half = max(4, 2 * beats_per_bar)
    g = np.exp(-0.5 * (np.linspace(-1.5, 1.5, 2 * half) ** 2))
    kernel = np.outer(g, g) * np.outer(np.r_[-np.ones(half), np.ones(half)], np.r_[-np.ones(half), np.ones(half)])
    padded = np.pad(ssm, half, mode="constant")
    novelty = np.array([(padded[i:i + 2 * half, i:i + 2 * half] * kernel).sum() for i in range(n)])
    novelty = np.maximum(0, novelty)
    if novelty.max() > 0:
        novelty = novelty / novelty.max()
    wait = 4 * beats_per_bar
    peaks = librosa.util.peak_pick(novelty, pre_max=wait // 2, post_max=wait // 2, pre_avg=wait, post_avg=wait,
                                   delta=0.05, wait=wait)
    bounds = sorted(float(times[p]) for p in peaks if 0 < p < n and 4.0 < times[p] < duration - 4.0)
    # Segment labels: a segment takes the letter of an earlier one that sounds alike.
    edges = [0] + [int(np.searchsorted(times, b)) for b in bounds] + [n]
    blocks = [(a, b) for a, b in zip(edges[:-1], edges[1:]) if b > a]
    sim = np.array([[ssm[a1:b1, a2:b2].mean() for (a2, b2) in blocks] for (a1, b1) in blocks])
    labels = []
    for j in range(len(blocks)):
        best, best_i = -1.0, -1
        for i in range(j):
            if sim[i, j] > best:
                best, best_i = sim[i, j], i
        if best_i >= 0 and best >= 0.6 * min(sim[best_i, best_i], sim[j, j]) and best > 0.15:
            labels.append(labels[best_i])
        else:
            used = set(labels)
            labels.append(next(c for c in string.ascii_uppercase + string.ascii_lowercase if c not in used))
    if len(labels) < len(bounds) + 1:
        labels += ["A"] * (len(bounds) + 1 - len(labels))
    return [round(b, 3) for b in bounds], labels


def energy_curve(y, sr, duration):
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0]
    t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=HOP)
    lo, hi = np.percentile(rms, 5), np.percentile(rms, 95)
    out = []
    for s in range(int(np.ceil(duration))):
        w = (t >= s) & (t < s + 1)
        if w.any():
            v = float(np.clip((rms[w].mean() - lo) / (hi - lo + 1e-9), 0, 1))
            out.append({"t": s, "v": round(v, 3)})
    return out


def stems_info(stems_dir):
    stems = {}
    for name in ("vocals", "drums", "bass", "other"):
        p = Path(stems_dir) / f"{name}.wav"
        if not p.exists():
            return None, None
        y, _ = librosa.load(str(p), sr=8000, mono=True)
        stems[name] = y
    power = {k: float(np.mean(v ** 2)) for k, v in stems.items()}
    total = sum(power.values()) + 1e-12
    shares = {k: round(v / total, 3) for k, v in power.items()}
    v = stems["vocals"]
    rms = librosa.feature.rms(y=v, frame_length=512, hop_length=256)[0]
    active = rms > 0.1 * np.percentile(rms, 95)
    f0, voiced, _ = librosa.pyin(v, fmin=65, fmax=800, sr=8000, frame_length=1024, hop_length=256)
    k = min(len(active), len(voiced))
    voiced_active = voiced[:k] & active[:k]
    f = f0[:k][voiced_active]
    vocal = {"medianF0Hz": None, "voicedShare": None, "pitchStability": None, "lowShare": None, "highShare": None}
    if active.sum() > 0:
        vocal["voicedShare"] = round(float(voiced_active.sum() / max(1, active[:k].sum())), 3)
    if len(f) >= 50:
        semis = 12 * np.log2(f / 440.0)
        smooth = np.convolve(semis, np.ones(5) / 5, mode="same")
        vocal.update({
            "medianF0Hz": round(float(np.median(f)), 1),
            "pitchStability": round(float(np.mean(np.abs(semis - smooth) < 0.5)), 3),
            "lowShare": round(float(np.mean(f < 165)), 3),
            "highShare": round(float(np.mean(f > 220)), 3),
        })
    return shares, vocal


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("out")
    ap.add_argument("--beats")
    ap.add_argument("--stems")
    a = ap.parse_args()
    y, sr = librosa.load(a.audio, sr=SR, mono=True)
    duration = len(y) / sr
    if a.beats and Path(a.beats).exists():
        b = json.loads(Path(a.beats).read_text(encoding="utf-8"))
        beats, downbeats, tracker = np.array(b["beats"]), np.array(b["downbeats"]), b.get("tracker", "beat_this")
    else:
        beats, downbeats, tracker = beats_librosa(y, sr)
    beats_per_bar, meter_conf = meter(beats, downbeats)
    ibi = np.diff(beats)
    bpm = float(60.0 / np.median(ibi)) if len(ibi) else 0.0
    bounds, labels = segment(y, sr, beats, beats_per_bar, duration) if len(beats) > 16 else ([], ["A"])
    shares, vocal = stems_info(a.stems) if a.stems else (None, None)
    result = {
        "duration": round(duration, 3),
        "bpm": round(bpm, 2),
        "beatTracker": tracker,
        "beats": [round(float(x), 3) for x in beats],
        "downbeats": [round(float(x), 3) for x in downbeats],
        "beatsPerBar": beats_per_bar,
        "meterConfidence": meter_conf,
        "boundaries": bounds,
        "labels": labels,
        "energy": energy_curve(y, sr, duration),
        "stemShares": shares,
        "vocal": vocal,
    }
    Path(a.out).write_text(json.dumps(result), encoding="utf-8")
    print(f"{duration:.1f}s {bpm:.1f} BPM {beats_per_bar}/x (conf {meter_conf}) tracker={tracker} "
          f"sections={len(bounds) + 1} labels={''.join(labels)} stems={'yes' if shares else 'no'}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
