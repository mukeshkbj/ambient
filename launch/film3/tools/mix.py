"""Mix the demo video's soundtrack.

Usage: python tools/mix.py
The story reuses film 2's voices, effects and bed envelopes, shifted to where the story clip sits.
Every other scene brings compositions/<id>.cues.json; its times are local to the scene's data-start in index.html.
Writes assets/mix.wav.
"""
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
FILM2 = ROOT.parent / "film2"
spec = importlib.util.spec_from_file_location("film2mix", FILM2 / "tools" / "mix.py")
f2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f2)
SR = f2.SR

HTML = (ROOT / "index.html").read_text(encoding="utf-8")
LENGTH = float(re.search(r'data-composition-id="main" data-start="0" data-duration="([\d.]+)"', HTML).group(1))
STARTS = {m.group(1): float(m.group(2)) for m in re.finditer(r'id="(\w+)"[^>]*?data-start="([\d.]+)"', HTML)}
STORY_IN, STORY_OUT = 3.75, 28.73
SHIFT = STARTS["story"] - STORY_IN
STORY_END = STARTS["story"] + STORY_OUT - STORY_IN

HOOK_FX = [("tap", t, 0.22 + 0.04 * i, 0.15 * (i % 2 * 2 - 1)) for i, t in enumerate([0.08, 0.6, 1.02, 1.38, 1.68, 1.94])]
HOOK_FX += [("drip", 0.35, 0.16, 0.2), ("drip", 1.25, 0.14, 0.2), ("drip", 2.2, 0.16, 0.2), ("swish", 2.42, 0.12, 0.0), ("hit", 2.62, 0.3, 0.0), ("hit", 4.42, 0.35, 0.0), ("whoosh", 6.85, 0.22, 0.0)]
GLUE_FX = [("hit", STARTS["bridge"] + 0.12, 0.4, 0.0), ("hit", STARTS["bridge"] + 1.72, 0.45, 0.0), ("whoosh", STARTS["bridge"] + 2.5, 0.22, 0.0)]
for name in ("honest", "built"):
    if name in STARTS:
        GLUE_FX += [("whoosh", STARTS[name], 0.2, 0.0)]
if "honest" in STARTS:
    GLUE_FX += [("tick", STARTS["honest"] + t, 0.35, 0.0) for t in (0.35, 3.75, 7.15, 10.55)]
if "built" in STARTS:
    b = STARTS["built"]
    GLUE_FX += [("tick", b + 0.55 + i * 0.32, 0.22, -0.4 + 0.2 * i) for i in range(5)]
    GLUE_FX += [("swish", b + 10.3, 0.2, 0.0), ("hit", b + 10.65, 0.5, 0.0), ("tick", b + 11.5, 0.35, 0.0)]
if "end" in STARTS:
    e = STARTS["end"]
    GLUE_FX += [("riser", e, 0.7, 0.0), ("impact", e, 1.0, 0.0), ("hit", e, 1.0, 0.0), ("sting", e + 0.05, 0.4, 0.0)]


def scene_cues():
    lines, effects = [], []
    for path in sorted((ROOT / "compositions").glob("*.cues.json")):
        sid = path.name.split(".")[0]
        if sid not in STARTS:
            continue
        at0 = STARTS[sid]
        data = json.loads(path.read_text(encoding="utf-8"))
        lines += [(l["file"], at0 + l["at"], l["text"], l.get("band", "phone")) for l in data.get("lines", [])]
        effects += [(e["name"], at0 + e["at"], e.get("gain", 0.4), e.get("pan", 0.0)) for e in data.get("effects", [])]
    return lines, effects


def level(x, seconds=3.0, target=0.12):
    hop = SR // 10
    win = int(seconds * 10)
    rms = np.sqrt(np.convolve((x[: len(x) // hop * hop].reshape(-1, hop) ** 2).mean(axis=1), np.ones(win) / win, mode="same"))
    gain = np.clip(target / np.maximum(rms, 1e-4), 0.25, 4.0)
    return (x * np.interp(np.arange(len(x)) / hop, np.arange(len(gain)), gain)).astype("float32")


def place(buf, x, at):
    i = int(at * SR)
    if i < 0:
        x, i = x[-i:], 0
    x = x[: max(0, len(buf) - i)]
    buf[i:i + len(x)] += x


def main():
    n = int(SR * LENGTH)
    voice = np.zeros(n, dtype="float32")
    fx = np.zeros((n, 2), dtype="float32")
    lines = [(file, at + SHIFT, text, band) for _, at, file, text, band in f2.LINES if STORY_IN <= at < STORY_OUT]
    effects = [(name, hit + SHIFT, gain, pan) for name, hit, gain, pan in f2.EFFECTS if STORY_IN + 0.3 <= hit < STORY_OUT]
    effects += [("whoosh", STARTS["story"], 0.25, 0.0)] + HOOK_FX + GLUE_FX
    more_lines, more_fx = scene_cues()
    lines += more_lines
    effects += more_fx
    for file, at, text, band in lines:
        x = f2.load(ROOT / "assets" / "vo" / f"{file}.wav")
        x = f2.phone(x) if band == "phone" else x
        place(voice, x * (0.9 if band == "phone" else 0.8), at)
    for name, hit, gain, pan in effects:
        x = {"ring": f2.ring, "drip": f2.drip}[name]() if name in ("ring", "drip") else f2.load(ROOT / "assets" / "sfx" / f"{name}.wav")
        stereo = np.outer(x * gain, [np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
        i = int((hit - f2.PEAK.get(name, 0)) * SR)
        if i < 0:
            stereo, i = stereo[-i:], 0
        stereo = stereo[: max(0, n - i)]
        fx[i:i + len(stereo)] += stereo
    bed = np.zeros(n, dtype="float32")
    music = ROOT / "assets" / "music"
    tension = [(0.0, 0.1), (2.5, 0.14), (2.62, 0.2), (7.0, 0.2)] + [(t + SHIFT, v) for t, v in f2.TENSION if STORY_IN < t < STORY_OUT]
    tension += [(STORY_END, 0.0), (LENGTH, 0.0)]
    release = [(0.0, 0.0)] + [(t + SHIFT, v) for t, v in f2.RELEASE if STORY_IN < t <= STORY_OUT] + [(STORY_END + 0.25, 0.0), (LENGTH, 0.0)]
    flex_start = STARTS["bridge"]
    flex_end = STARTS.get("end", LENGTH)
    drive = [(0.0, 0.0), (flex_start, 0.0), (flex_start + 0.15, 0.45), (flex_start + 2.6, 0.5)]
    for sid in ("fool", "around", "screens", "honest", "built", "real"):
        if sid in STARTS:
            s = STARTS[sid]
            drive += [(s - 0.12, 0.55), (s - 0.02, 0.28), (s + 0.35, 0.55)]
    drive += [(flex_end - 0.4, 0.6), (flex_end - 0.02, 0.0), (LENGTH, 0.0)]
    resolve = [(0.0, 0.0), (flex_end, 0.0), (flex_end + 0.3, 0.7), (LENGTH - 1.2, 0.6), (LENGTH, 0.0)]
    tracks = [
        ("pulse-small-7.wav", 0.0, tension),
        ("lift-small-3.wav", 21.93 + SHIFT, release),
        ("drive-long-7.wav", flex_start, sorted(drive)),
        ("resolve-small-7.wav", flex_end, resolve),
    ]
    for file, start, points in tracks:
        m = f2.load(music / file)
        m = level(m) if file.startswith("drive") else m
        track = np.zeros(n, dtype="float32")
        place(track, m, start)
        bed += track * f2.envelope(points, n)
    bed *= f2.duck(voice)
    haas = int(0.011 * SR)
    wide = np.stack([bed, np.concatenate([np.zeros(haas, dtype="float32"), bed[:-haas]])], axis=1)
    mix = voice[:, None] + fx + wide
    raw = ROOT / "assets" / "mix-raw.wav"
    sf.write(raw, mix, SR, subtype="PCM_24")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", "highshelf=f=3500:g=7,equalizer=f=320:t=q:w=1:g=-2,equalizer=f=2000:t=o:w=1.5:g=-2.5,loudnorm=I=-14:TP=-2.5:LRA=11", "-ar", str(SR), str(ROOT / "assets" / "mix.wav")], check=True)
    raw.unlink()
    print(json.dumps({"length": LENGTH, "lines": len(lines), "effects": len(effects), "starts": STARTS}))


if __name__ == "__main__":
    main()
