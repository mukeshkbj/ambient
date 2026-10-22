"""Generate a long original score bed locally with MusicGen, extended by continuation. No third-party music.

Usage: python tools/music.py drive 7 100   (prompt key, seed, seconds). Writes assets/music/<key>-long-<seed>.wav.
"""
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration

PROMPTS = {
    "drive": "modern minimal electronic product launch, tight plucked synth arpeggio, deep sub bass, crisp light percussion, confident and warm, 104 bpm",
    "build": "modern cinematic product launch build, plucked synth arpeggio and warm piano, rising energy, light claps and hats, confident, 104 bpm, clean mix",
}
key, seed, seconds = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
torch.manual_seed(seed)
device = "cuda" if torch.cuda.is_available() else "cpu"
proc = AutoProcessor.from_pretrained("facebook/musicgen-small")
model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small").to(device)
sr = model.config.audio_encoder.sampling_rate
inp = proc(text=[PROMPTS[key]], padding=True, return_tensors="pt").to(device)
audio = model.generate(**inp, do_sample=True, guidance_scale=3.5, max_new_tokens=1500)[0, 0].cpu().numpy()
while len(audio) < seconds * sr:
    tail = audio[-10 * sr:]
    inp = proc(audio=tail, sampling_rate=sr, text=[PROMPTS[key]], padding=True, return_tensors="pt").to(device)
    more = model.generate(**inp, do_sample=True, guidance_scale=3.5, max_new_tokens=1500)[0, 0].cpu().numpy()
    audio = np.concatenate([audio[:-10 * sr], more])
    print("length", len(audio) / sr, flush=True)
out = Path(__file__).resolve().parents[1] / "assets" / "music" / f"{key}-long-{seed}.wav"
sf.write(out, audio[: int(seconds * sr)], sr)
print("wrote", out)
