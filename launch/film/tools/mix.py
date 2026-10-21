"""Mix the film's soundtrack and write the word timings the composition reads.

Usage: python tools/mix.py [tension.wav release.wav]   (defaults: assets/music/)
Writes assets/mix.wav and cues.js. Every voice and effect time lives in CUES below.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfilt

ROOT = Path(__file__).resolve().parents[1]
SR = 48000
LENGTH = 36.5

LINES = [
    ("hook-joe", 0.15, "joe-plusparts", "Yes, plus parts.", "phone"),
    ("hook-amb", 1.70, "amb-onetotal", "Sorry. I need one total price.", "phone"),
    ("ask", 4.85, "maya-ask", "Alexa, get the sink fixed. Keep it under one fifty.", "room"),
    ("disclose", 9.60, "amb-disclose", "Hi. This is an AI assistant, calling for Maya.", "phone"),
    ("quote", 12.85, "joe-180", "It'll be one eighty.", "phone"),
    ("check", 14.60, "amb-check", "One moment. Let me check with Maya.", "phone"),
    ("offer", 17.35, "amb-150", "Could you do one fifty?", "phone"),
    ("counter", 18.95, "joe-160", "I could do one sixty.", "phone"),
    ("allin", 21.70, "joe-allin", "Fair enough. That's all in.", "phone"),
    ("yes", 24.20, "joe-yes", "Yes, that's right. See you then.", "phone"),
]

EFFECTS = [
    ("rewind", 4.55, 0.5, 0.0),
    ("whoosh", 8.35, 0.25, 0.4),
    ("ring", 8.35, 0.35, 0.5),
    ("pickup", 9.42, 0.5, 0.5),
    ("tick", 13.62, 0.25, -0.5),
    ("tap", 16.95, 0.6, 0.35),
    ("tick", 17.05, 0.25, -0.5),
    ("tick", 20.10, 0.25, -0.5),
    ("tap", 21.00, 0.6, -0.2),
    ("stopdown", 21.30, 0.35, 0.0),
    ("impact", 23.70, 0.55, 0.0),
    ("ding", 23.72, 0.35, 0.0),
    ("whoosh", 27.32, 0.3, 0.4),
    ("whoosh", 28.32, 0.25, 0.4),
    ("whoosh", 29.32, 0.25, 0.4),
    ("swish", 30.32, 0.3, -0.3),
    ("sting", 33.40, 0.45, 0.0),
]

PEAK = {"rewind": 0.853, "whoosh": 0.162, "swish": 0.35, "stopdown": 0.103}

TENSION = [(0.0, 0.0), (4.6, 0.0), (5.4, 0.16), (16.9, 0.2), (20.9, 0.24), (21.1, 0.0), (36.5, 0.0)]
RELEASE = [(0.0, 0.0), (23.6, 0.0), (23.7, 0.42), (26.5, 0.3), (30.4, 0.38), (35.6, 0.3), (36.5, 0.0)]


def load(path):
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    return mono if sr == SR else resample_poly(mono, SR, sr).astype("float32")


def phone(x):
    band = sosfilt(butter(4, [300, 3400], btype="band", fs=SR, output="sos"), x)
    return np.tanh(band * 1.6) / 1.6


def ring():
    t = np.arange(int(SR * 0.9)) / SR
    tone = 0.5 * (np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 480 * t))
    env = np.minimum(1, t / 0.01) * np.minimum(1, (0.9 - t) / 0.05)
    return phone(tone * env * 0.5)


def words(x, text):
    hop = SR // 100
    rms = np.sqrt(np.convolve(x**2, np.ones(hop) / hop, mode="same"))[::hop]
    voiced = np.flatnonzero(rms > rms.max() * 0.06)
    start, end = voiced[0], voiced[-1]
    tokens = text.split()
    weight = np.array([len(w.strip(".,?")) + 2 for w in tokens], dtype=float)
    edges = start + np.concatenate([[0], np.cumsum(weight)]) / weight.sum() * (end - start)
    onsets = [start]
    for e in edges[1:-1]:
        lo, hi = int(max(start, e - 12)), int(min(end, e + 12))
        onsets.append(lo + int(np.argmin(rms[lo:hi + 1])))
    return [{"w": w, "t": round(o / 100, 2)} for w, o in zip(tokens, onsets)]


def envelope(points, n):
    t = np.arange(n) / SR
    xs, ys = zip(*points)
    return np.interp(t, xs, ys)


def main():
    n = int(SR * LENGTH)
    voice = np.zeros(n, dtype="float32")
    fx = np.zeros((n, 2), dtype="float32")
    cues = {}
    for cue, at, file, text, band in LINES:
        x = load(ROOT / "assets" / "vo" / f"{file}.wav")
        cues[cue] = {"at": at, "end": round(at + len(x) / SR, 2), "text": text, "words": [{"w": w["w"], "t": round(at + w["t"], 2)} for w in words(x, text)]}
        x = phone(x) if band == "phone" else x
        i = int(at * SR)
        voice[i:i + len(x)] += x[: n - i] * (0.9 if band == "phone" else 0.8)
    for name, hit, gain, pan in EFFECTS:
        x = ring() if name == "ring" else load(ROOT / "assets" / "sfx" / f"{name}.wav")
        i = int((hit - PEAK.get(name, 0)) * SR)
        x = x[: n - i] * gain
        fx[i:i + len(x)] += np.outer(x, [np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
    bed = np.zeros(n, dtype="float32")
    beds = sys.argv[1:] or [ROOT / "assets" / "music" / "pulse-small-7.wav", ROOT / "assets" / "music" / "resolve-small-7.wav"]
    for path, points in zip(beds, (TENSION, RELEASE)):
        m = load(path)
        start = int(23.6 * SR) if points is RELEASE else 0
        m = np.concatenate([np.zeros(start, dtype="float32"), m])
        m = np.concatenate([m, np.zeros(max(0, n - len(m)), dtype="float32")])[:n]
        bed += m * envelope(points, n)
    haas = int(0.011 * SR)
    wide = np.stack([bed, np.concatenate([np.zeros(haas, dtype="float32"), bed[:-haas]])], axis=1)
    mix = voice[:, None] + fx + wide
    raw = ROOT / "assets" / "mix-raw.wav"
    sf.write(raw, mix, SR, subtype="PCM_24")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", "loudnorm=I=-13.2:TP=-1.5:LRA=11", "-ar", str(SR), str(ROOT / "assets" / "mix.wav")], check=True)
    raw.unlink()
    (ROOT / "cues.js").write_text("window.CUES = " + json.dumps(cues, indent=1) + ";\n", encoding="utf-8")
    print(json.dumps({k: [w["t"] for w in v["words"]] for k, v in cues.items()}))


main()
