# Manim set-pieces for the SST Adventure

Pre-rendered, cinematic math animations for the [SST Adventure](../src/sst/)
interactive presentation. These are the **Tier-2** visuals from the build plan:
geometry that is hard to do live in the browser (sphere Exp/Log maps, the
principal fiber-bundle projection, Nyström spectral convergence). Lightweight,
manipulable demos stay as JS widgets under `src/assets/js/sst/widgets/`.

## Why it lives here (not in TDA-SST)

These animations are presentation assets for the website, not part of the
research pipeline, so they live with the site that consumes them. They depend
only on `manim` + `numpy` (see `requirements.txt`) — no TDA-SST import.

## Setup

```bash
# from the website repo root, in Git Bash
python -m venv .venv
source .venv/Scripts/activate
pip install -r manim/requirements.txt
# also need ffmpeg on PATH; LaTeX too if a scene uses Tex/MathTex
```

`.venv/` and `manim/.media/` should be git-ignored (build artifacts).

## Render

```bash
./manim/render.sh                 # all registered scenes -> src/assets/video/sst/
./manim/render.sh exp_log_maps    # just one
QUALITY=l ./manim/render.sh       # draft quality while iterating
```

Each rendered `.webm` lands in `src/assets/video/sst/` and is embedded in a
scene via frontmatter `mount: video:<name>` (player support for the `video:`
mount type comes in Milestone 4).

## Adding a scene

1. Add `manim/scenes/<name>.py` defining one `Scene` subclass.
2. Register it in the `SCENES` map in `render.sh` (`<name>` -> `ClassName`).
3. Render, then reference it from an SST scene file with `mount: video:<name>`.

## Status

`scenes/exp_log_maps.py` is a **starter scaffold** — it draws the static setup
so the pipeline is verifiable end-to-end. Real choreography is Milestone 4.
