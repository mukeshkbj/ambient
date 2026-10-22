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
STORY_IN, STORY_OUT = 3.95, 28.73
SHIFT = STARTS["story"] - STORY_IN
STORY_END = STARTS["story"] + STORY_OUT - STORY_IN

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
    effects = [(name, hit + SHIFT, gain, pan) for name, hit, gain, pan in f2.EFFECTS if STORY_IN + 0.1 <= hit < STORY_OUT]
    effects += [("whoosh", STARTS["story"], 0.25, 0.0)]
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
    tension = [(0.0, 0.12), (2.0, 0.16), (2.12, 0.22), (STARTS["story"] - 0.1, 0.22)] + [(t + SHIFT, v) for t, v in f2.TENSION if STORY_IN < t < STORY_OUT]
    tension += [(STORY_END, 0.0), (LENGTH, 0.0)]
    release = [(0.0, 0.0)] + [(t + SHIFT, v) for t, v in f2.RELEASE if STORY_IN < t <= STORY_OUT] + [(STORY_END + 0.25, 0.0), (LENGTH, 0.0)]
    flex_start = STARTS["bridge"]
    flex_end = STARTS.get("end", LENGTH)
    drive = [(0.0, 0.0), (flex_start, 0.0), (flex_start + 0.15, 0.45), (flex_start + 2.6, 0.5)]
    for sid in ("fool", "around", "screens", "honest", "built", "real"):
        if sid in STARTS:
            s = STARTS[sid]
            drive += [(s - 0.12, 0.55), (s - 0.02, 0.28), (s + 0.35, 0.55)]
    drive += [(flex_end - 0.4, 0.6), (flex_end + 0.3, 0.0), (LENGTH, 0.0)]
    resolve = [(0.0, 0.0), (flex_end, 0.0), (flex_end + 0.25, 0.85), (LENGTH - 1.4, 0.85), (LENGTH, 0.0)]
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
