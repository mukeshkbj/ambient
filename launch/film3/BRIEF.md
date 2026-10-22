# Scene builder brief (shared by every scene agent)

You build ONE scene of Ambient's Devpost demo video as a HyperFrames sub-composition. Read `launch/film3/SPEC.md` first (the whole film, the look, the honesty rule, the cue format). Then read `launch/film2/index.html` in full: it is the design source of truth, and your scene must look like it belongs in the same film. Load the `hyperframes` skill and its `references/format.md` and `references/motion.md` before you write markup.

Quality bar: recent.design launch films and inspora.design UI clips. Reviewers called earlier work "horrid" and "shit". Generic AI motion graphics (centered text fading in, cards sliding up, purple glow, emoji) fail. Every frame needs one focal point, real UI detail, generous space and precise type. Motion is choreographed: anticipation, a clear lead element, staggered followers, settles with expo.out or a damped spring, and numbers that roll.

## Where to work

- Repo: `C:/Users/mukes/honey/hermesambient`. Branch `hackathon/household-consent`. Do not commit, push or switch branches. Touch no file outside the paths below.
- Make your own scratch project: copy `launch/film3/` to `launch/film3-lab-<id>/` (skip `assets/video` and `renders`). Its `index.html` mounts only your scene at 0 with the scene's length, on the porcelain ground. Iterate there.
- Deliver into `launch/film3/`: `compositions/<id>.html`, `compositions/<id>.cues.json`, and any new files in `assets/vo/` or `assets/img/` with names prefixed `<id>-`. Leave the lab folder in place.

## Earlier attempt

A previous builder started this scene in `launch/film3-lab-<id>/` and was stopped early. You may read and reuse what is good there, or start over. Its facts may be right; re-check each one against the code.

## Rules

- Scene file: everything inside `<template>`; scene root `<div id="<id>" data-composition-id="<id>" data-width="1920" data-height="1080">`, styled as `#<id> { position:absolute; inset:0 }`; timeline registered as `window.__timelines["<id>"]`. Prefix every id and class with `<id>-` so nothing collides with other scenes. Use `fromTo`, never `from`. No `Date.now()`, no `Math.random()`, no `repeat:-1`. GSAP comes from the root page (`https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`); include the same script tag in your lab `index.html`. Fonts: Inter is bundled. Newsreader and JetBrains Mono need `@font-face` in the ROOT page (they do not resolve inside a scene without it): copy the four `@font-face` rules from `launch/film3/index.html` into your lab `index.html`.
- Asset paths are root-relative (`assets/...`).
- No code comments.
- Before running hyperframes in Bash, run `export PATH=$(echo "$PATH" | tr ':' '\n' | grep -vi "cua" | paste -sd:)`. Use `npx --yes hyperframes@0.8.185 check`, `snapshot --at t1,t2,...` and `render -o renders/x.mp4` inside your lab folder. Snapshots that jump straight to a late time can show wrong states; verify motion from a rendered MP4 (`ffmpeg -ss T -i x.mp4 -frames:v 1 f.png`) and look at the frames yourself.
- Voices: `npx --yes hyperframes@0.8.185 tts "text" -v <voice> -o launch/film3/assets/vo/<id>-<name>.wav` (Joe am_michael, Ambient af_heart, Maya af_bella, Spanish: ef_dora with `-l es`). Phone voices get band "phone" in the cues file.
- Honesty: every word, price, name and verdict on screen must be true of the code today. Read `src/`, `docs/demo/`, `docs/DEVPOST.md` and `docs/video-script.md` for the real names and lines. If a fact is not in the repo, leave it out.

## Loop

Build, render the lab MP4, extract a frame every 0.5 s into a contact sheet, look at it as a harsh art director against the bar, fix the worst three problems, repeat at least three times. Stop when you would show it next to a recent.design film.

## Report

Return: the files you delivered, the scene length, the cue list, the frame times a reviewer should look at, the facts you used with their source file, and anything you could not make true.
