#!/usr/bin/env bash
# Render Manim set-pieces into the website's video asset folder.
#
# Usage:
#   ./manim/render.sh                 # render every scene at production quality
#   ./manim/render.sh exp_log_maps    # render a single scene file (by basename)
#   QUALITY=l ./manim/render.sh       # draft quality (l/m/h/k); default k (4K)
#
# Requires: a venv with manim installed (see manim/requirements.txt), plus
# ffmpeg (and LaTeX if a scene uses Tex/MathTex) on PATH.
#
# Invoked via `python -m manim`, NOT the `manim.exe` wrapper: on Microsoft Store
# (MSIX) Python the .exe goes through an app-execution alias that strips
# USERPROFILE, which breaks manim's Path.home() config lookup. Override the
# interpreter with MANIM_PY if needed, and export USERPROFILE on Store Python:
#   USERPROFILE="$USERPROFILE" MANIM_PY=~/venvs/zgrey-github-io/Scripts/python.exe ./manim/render.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENE_DIR="$REPO_ROOT/manim/scenes"
OUT_DIR="$REPO_ROOT/src/assets/video/sst"
QUALITY="${QUALITY:-k}"
MANIM_PY="${MANIM_PY:-python}"

mkdir -p "$OUT_DIR"

# Map each scene file to the Scene class inside it (basename -> ClassName).
declare -A SCENES=(
  ["exp_log_maps"]="ExpLogMaps"
  ["fiber_bundle"]="FiberBundle"
  ["tpca"]="TangentPCA"
)

render_one () {
  local base="$1"
  local cls="${SCENES[$base]:-}"
  if [[ -z "$cls" ]]; then
    echo "!! no Scene class registered for '$base' in render.sh" >&2
    return 1
  fi
  echo ">> rendering $base ($cls) at quality=$QUALITY"
  # --progress_bar none + -v WARNING keep stderr quiet: Manim's progress bar and
  # rich tracebacks otherwise flood the pipe and can deadlock a backgrounded run.
  "$MANIM_PY" -m manim "-q${QUALITY}" --format=webm \
    --progress_bar none -v WARNING \
    --media_dir "$REPO_ROOT/manim/.media" \
    -o "$base" \
    "$SCENE_DIR/$base.py" "$cls"
  # manim nests output under .media/videos/<file>/<res>/<name>.webm — flatten it.
  local found
  found="$(find "$REPO_ROOT/manim/.media/videos/$base" -name "$base.webm" | head -n1)"
  cp "$found" "$OUT_DIR/$base.webm"
  echo "   -> $OUT_DIR/$base.webm"
}

if [[ $# -ge 1 ]]; then
  render_one "$1"
else
  for base in "${!SCENES[@]}"; do
    render_one "$base"
  done
fi

echo "done. videos in $OUT_DIR"
