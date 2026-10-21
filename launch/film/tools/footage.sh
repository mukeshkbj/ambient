#!/usr/bin/env bash
# Download the film's Pexels clips (Pexels license: free use, no attribution) and cut each shot
# to 1920x1080, 30 fps, muted, in one warm, low-key grade. Output: assets/footage/ (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/.."
src=assets/footage/src
mkdir -p "$src"

fetch() {
  [ -s "$src/$1.mp4" ] || curl -sL -A "Mozilla/5.0" "https://videos.pexels.com/video-files/$2" -o "$src/$1.mp4"
}
fetch joe 6930960/6930960-hd_1080_1920_25fps.mp4
fetch kitchen 35674405/15117550_1920_1080_30fps.mp4
fetch drip 4571346/4571346-hd_1920_1080_25fps.mp4
fetch ring 8060393/8060393-hd_2048_1080_25fps.mp4
fetch tap 7559978/7559978-hd_1080_1920_25fps.mp4
fetch fix 7584858/7584858-hd_1920_1080_25fps.mp4

grade="eq=brightness=0.0:contrast=1.06:saturation=0.85,colorbalance=rs=0.04:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03,vignette=PI/4.2"
portrait="crop=1080:608:0:%s,scale=1920:1080:flags=lanczos"
wide="scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080"

shot() {
  local name=$1 clip=$2 from=$3 len=$4 frame=$5 extra=${6:-}
  ffmpeg -v error -y -ss "$from" -t "$len" -i "$src/$clip.mp4" -an \
    -vf "${frame},${grade}${extra:+,$extra},fps=30,format=yuv420p" \
    -c:v libx264 -crf 18 -preset slow -movflags +faststart "assets/footage/$name.mp4"
  echo "$name"
}

shot hook joe 2.0 4.6 "$(printf "$portrait" 700)" "zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30"
shot back joe 2.0 4.0 "$(printf "$portrait" 700)" "reverse,setpts=PTS/5"
shot home kitchen 0.0 2.2 "$wide"
shot drip drip 2.0 3.2 "$wide"
shot ring ring 1.0 4.6 "$wide" "gblur=sigma=6"
shot joe2 joe 9.0 4.6 "$(printf "$portrait" 700)"
shot maya tap 0.8 4.6 "$(printf "$portrait" 600)"
shot trap joe 13.0 2.6 "$(printf "$portrait" 700)"
shot fix fix 0.5 3.8 "$wide"
shot calm kitchen 2.2 4.0 "$wide"

ffmpeg -v error -y -ss 3.75 -i "$src/drip.mp4" -frames:v 1 "$src/dry.png"
ffmpeg -v error -y -loop 1 -t 3.6 -i "$src/dry.png" -an \
  -vf "${wide},${grade},zoompan=z='1+0.0005*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,format=yuv420p" \
  -c:v libx264 -crf 18 -preset slow -movflags +faststart assets/footage/dry.mp4
echo dry
