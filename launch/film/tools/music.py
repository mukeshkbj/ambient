"""Generate the film's original score locally with MusicGen. No third-party music.

Usage: python tools/music.py small 7   (model size, seed). The film uses pulse-small-7 and lift-small-3.
Writes WAVs to the current directory; copy the chosen takes to assets/music/.
"""
import sys, numpy as np, soundfile as sf, torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration
torch.manual_seed(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
name = sys.argv[1] if len(sys.argv) > 1 else "small"
proc = AutoProcessor.from_pretrained(f"facebook/musicgen-{name}")
model = MusicgenForConditionalGeneration.from_pretrained(f"facebook/musicgen-{name}")
prompts = {
 "pulse": "minimal cinematic underscore, soft felt piano ostinato in D minor over a low warm synth pulse, restrained, building tension, no drums, 96 bpm, clean modern film score",
 "resolve": "warm hopeful cinematic piano and soft strings swell resolving to a major chord, gentle and confident, modern product film, 96 bpm, no drums",
 "lift": "minimal cinematic underscore, soft felt piano ostinato in D major over a low warm synth pulse, opening up, hopeful and calm, no drums, 96 bpm, clean modern film score",
 "drive": "modern minimal electronic product launch, tight plucked synth arpeggio, deep sub bass, crisp light percussion, confident and warm, 104 bpm",
}
for k, p in prompts.items():
    inp = proc(text=[p], padding=True, return_tensors="pt")
    audio = model.generate(**inp, do_sample=True, guidance_scale=3.5, max_new_tokens=1500)
    sr = model.config.audio_encoder.sampling_rate
    sf.write(f"{k}-{name}-{sys.argv[2] if len(sys.argv)>2 else 1}.wav", audio[0, 0].numpy(), sr)
    print("wrote", k, flush=True)
