import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from mix import LENGTH, LINES, ROOT, SR, load

FPS = 30
n = int(LENGTH * FPS) + 1
level = np.zeros(n)
speaker = [""] * n
for cue, at, file, text, band in LINES:
    x = load(ROOT / "assets" / "vo" / f"{file}.wav")
    hop = SR // FPS
    frames = len(x) // hop
    rms = np.sqrt((x[: frames * hop].reshape(frames, hop) ** 2).mean(axis=1))
    start = int(round(at * FPS))
    for i, r in enumerate(rms):
        if start + i < n:
            level[start + i] = max(level[start + i], r)
            if r > 0.01:
                speaker[start + i] = "maya" if file.startswith("maya") else "amb" if file.startswith("amb") else "joe"
level = np.clip(level / np.percentile(level[level > 0], 95), 0, 1)
(ROOT / "levels.js").write_text("window.LEVELS = " + json.dumps({"fps": FPS, "level": [round(float(v), 3) for v in level], "speaker": speaker}) + ";\n", encoding="utf-8")
print(n)
