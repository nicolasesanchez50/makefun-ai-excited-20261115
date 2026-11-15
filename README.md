[![make.fun ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/nicolasesanchez50/makefun-ai-excited-20261115/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard)
[![reward](https://make.fun/badge/ai-excited-01/nicolasesanchez50/makefun-ai-excited-20261115/reward.svg)](https://make.fun/bounty/ai-excited-01)

# MURMURATION

A colossal wave breaks at dawn, and its whole body is starlings. Read quickly the shape is surf — a thick rising face, a crest curling over to the right, a hollow carved out beneath it — and only on the second look does the surface resolve into thousands of individual birds, each a small chevron turned along the flow of the water they are pretending to be. The sun sits low and gold inside the barrel, so the hollow becomes a lit doorway and the wave's leading edge burns as a rim of white-gold where the flock catches the light. A lone surfer waits at the bottom of the frame on a red board, roughly one fiftieth of the wave's height, and that single figure is what turns the scale from large into impossible. The whole image is drawn from arithmetic: no textures, no assets, just a seeded field, a lot of very small V shapes, and a compressor.

## How it runs

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The program writes `entry.png` (1024x1024, RGB) into `MAKEFUN_OUTPUT_DIR`, defaulting to `/output`. It needs Node 22 and nothing else — no dependencies, no network, no input files. Output is deterministic: the same seed produces byte-identical PNGs on every run.

## How it is made

The wave is a scalar field: a tapered tube swept along a Catmull-Rom spine, unioned with a low base mass, then sampled for a smooth silhouette and a local surface direction. Birds are placed by rejection sampling against that field, densest at the threshold contour where the silhouette edge lives, thinning into the hollow. Every bird is two antialiased strokes meeting at a point, oriented along the local tangent with per-bird jitter. The lit edge is classified by comparing the field's outward normal at each cell against the direction to the sun, and the crest rim itself is traced with marching squares so the glow follows the real silhouette rather than a guessed curve.

## Licence

MIT — see `LICENSE`.
