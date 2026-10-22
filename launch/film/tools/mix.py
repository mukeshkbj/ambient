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
LENGTH = 32.83

LINES = [
    ("hook-joe", 0.15, "joe-plusparts", "Yes, plus parts.", "phone"),
    ("hook-amb", 1.70, "amb-onetotal", "Sorry. I need one total price.", "phone"),
    ("ask", 4.4, "maya-ask", "Alexa, fix the sink. Under one fifty.", "room"),
    ("disclose", 7.93, "amb-disclose", "Hi. This is an AI assistant, calling for Maya.", "phone"),
    ("quote", 11.18, "joe-180", "It'll be one eighty.", "phone"),
    ("check", 12.93, "amb-check", "One moment. Let me check with Maya.", "phone"),
    ("offer", 15.68, "amb-150", "Could you do one fifty?", "phone"),
    ("counter", 17.28, "joe-160", "I could do one sixty.", "phone"),
    ("allin", 20.03, "joe-allin", "Fair enough. That's all in.", "phone"),
    ("yes", 22.53, "joe-yes", "Yes, that's right. See you then.", "phone"),
]

EFFECTS = [
    ("hit", 0.02, 0.4, 0.0),
    ("swish", 2.62, 0.12, -0.3),
    ("hit", 3.65, 0.25, 0.0),
    ("rewind", 4.25, 0.5, 0.0),
    ("drip", 4.75, 0.36, 0.2),
    ("drip", 5.65, 0.32, 0.2),
    ("drip", 6.55, 0.3, 0.2),
    ("whoosh", 7.15, 0.25, 0.4),
    ("ring", 7.15, 0.35, 0.5),
    ("pickup", 7.75, 0.5, 0.5),
    ("hit", 11.08, 0.22, 0.0),
    ("hit", 12.26, 0.6, -0.2),
    ("whoosh", 14.15, 0.2, 0.4),
    ("tap", 15.28, 0.6, 0.35),
    ("hit", 15.93, 0.45, -0.2),
    ("hit", 18.93, 0.55, -0.2),
    ("tap", 19.33, 0.6, -0.2),
    ("stopdown", 19.63, 0.35, 0.0),
    ("drip", 19.75, 0.55, 0.0),
    ("impact", 22.03, 1.0, 0.0),
    ("hit", 22.03, 0.5, 0.0),
    ("ding", 22.05, 0.35, 0.0),
    ("whoosh", 24.23, 0.25, 0.3),
    ("swish", 26.53, 0.3, -0.3),
    ("riser", 29.33, 0.2, 0.0),
    ("impact", 29.33, 1.0, 0.0),
    ("hit", 29.33, 0.6, 0.0),
    ("sting", 29.38, 0.4, 0.0),
]

PEAK = {"rewind": 0.853, "whoosh": 0.162, "swish": 0.35, "stopdown": 0.103, "riser": 2.771}

TENSION = [(0.0, 0.16), (3.6, 0.2), (4.3, 0.05), (6.9, 0.07), (7.4, 0.14), (11.0, 0.14), (11.3, 0.3), (15.23, 0.3), (19.23, 0.42), (19.48, 0.0), (32.83, 0.0)]
RELEASE = [(0.0, 0.0), (21.23, 0.0), (21.93, 0.2), (22.03, 0.6), (24.53, 0.36), (26.53, 0.38), (29.18, 0.42), (29.31, 0.0), (29.4, 0.0), (29.7, 0.45), (32.83, 0.4)]


def load(path):
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    return mono if sr == SR else resample_poly(mono, SR, sr).astype("float32")


def phone(x):
    band = sosfilt(butter(4, [300, 3400], btype="band", fs=SR, output="sos"), x)
    return np.tanh(band * 1.6) / 1.6


def drip():
    t = np.arange(int(SR * 0.12)) / SR
    tone = np.sin(2 * np.pi * (700 * t + 9000 * t**2)) * np.exp(-t / 0.025)
    click = np.exp(-t / 0.002) * np.sin(2 * np.pi * 3000 * t)
    return (0.8 * tone + 0.3 * click).astype("float32")


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


def duck(voice, depth=0.6):
    level = np.abs(voice)
    smooth = np.zeros_like(level)
    attack, release = np.exp(-1 / (0.03 * SR)), np.exp(-1 / (0.9 * SR))
    state = 0.0
    for i, x in enumerate(level[:: SR // 1000]):
        state = max(x, state * (release if x < state else attack))
        smooth[i * (SR // 1000):(i + 1) * (SR // 1000)] = state
    return 1 - depth * np.clip(smooth / 0.08, 0, 1)


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
        x = {"ring": ring, "drip": drip}[name]() if name in ("ring", "drip") else load(ROOT / "assets" / "sfx" / f"{name}.wav")
        i = int((hit - PEAK.get(name, 0)) * SR)
        x = x[: n - i] * gain
        fx[i:i + len(x)] += np.outer(x, [np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
    bed = np.zeros(n, dtype="float32")
    beds = sys.argv[1:] or [ROOT / "assets" / "music" / "pulse-small-7.wav", ROOT / "assets" / "music" / "lift-small-3.wav"]
    for path, points in zip(beds, (TENSION, RELEASE)):
        m = load(path)
        start = int(21.93 * SR) if points is RELEASE else 0
        m = np.concatenate([np.zeros(start, dtype="float32"), m])
        m = np.concatenate([m, np.zeros(max(0, n - len(m)), dtype="float32")])[:n]
        bed += m * envelope(points, n)
    bed *= duck(voice)
    haas = int(0.011 * SR)
    wide = np.stack([bed, np.concatenate([np.zeros(haas, dtype="float32"), bed[:-haas]])], axis=1)
    mix = voice[:, None] + fx + wide
    raw = ROOT / "assets" / "mix-raw.wav"
    sf.write(raw, mix, SR, subtype="PCM_24")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", "highshelf=f=3500:g=7,equalizer=f=320:t=q:w=1:g=-2,equalizer=f=2000:t=o:w=1.5:g=-2.5,loudnorm=I=-13.2:TP=-1.5:LRA=11", "-ar", str(SR), str(ROOT / "assets" / "mix.wav")], check=True)
    raw.unlink()
    (ROOT / "cues.js").write_text("window.CUES = " + json.dumps(cues, indent=1) + ";\n", encoding="utf-8")
    print(json.dumps({k: [w["t"] for w in v["words"]] for k, v in cues.items()}))


main()
