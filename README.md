# Vistas As Seen

Help artists turn landscape photos into painting references that better express the scale they experienced on location. Compare **crop only** with **depth-aware enhancement**, keeping the original in view.

## Sponsorship

**This project is sponsored by Crossborder Art & Media LLC.**

Licensed under [Apache-2.0](LICENSE), with sponsorship attribution in [NOTICE](NOTICE). Redistributed derivative works must preserve applicable notices as specified in Section 4(d); a visible app credit is welcome but not required. Third-party dependencies and model weights retain their own licenses.

Photographers and painters have long discussed distant scenery losing prominence in photos and the limits of photographic references. See [Michael Frye](https://www.michaelfrye.com/2015/03/29/lenses-perspective/), [Aaron Hertzmann](https://pmc.ncbi.nlm.nih.gov/articles/PMC11055503/), and [Koo Schadler](https://kooschadler.com/techniques/photo-references.pdf). This POC explores whether controlled depth-based adjustment makes those references more useful.

## See the difference

**Crop only (left) · Depth-enhanced (right)** — actual app output from the [sample photo](samples/IMG20240105123302.jpg).

![Crop only and depth-enhanced perspective side by side](docs/showcase/comparison-defaults-50mm.png)

**Original with the shared crop outlined:**

![Original landscape with crop overlay](docs/showcase/original-overlay-defaults-50mm.png)

App defaults: 50 mm target, 22% emphasis, centered crop and anchor, Small model. This capture used GPU inference and an assumed 24 mm source focal length. [Full settings](docs/showcase/settings.json).

## Run

Requires Node.js 22.18+ or Node 24 and a current desktop browser.

```sh
npm install
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173).

## Try it

1. Import a JPEG, PNG, or WebP (HEIC where supported). Check the source focal length; missing EXIF defaults to 24 mm.
2. Choose the target focal length and drag the crop on the original preview. Click outside the box to recenter; arrow keys fine-tune.
3. Choose **Small**, **Base**, or **Large**, then **Estimate depth on this device**. GPU is preferred, with automatic CPU fallback. First use downloads model weights; photos stay local.
4. Adjust background emphasis and the anchor. Inspect the depth map, compare without labels, and record your preference.
5. Export the crop, enhanced PNG, or edit recipe. Save your outputs before closing or refreshing; sessions are not persisted.

## POC limits

- Working images and exports are capped at **1600 px** on the long edge; uploads at 40 MB.
- Enhancement is an artistic warp. It can bend straight structures or stretch depth boundaries; it is not physical camera reconstruction.
- Depth Anything V2 Small uses Apache-2.0 weights. **Base and Large use noncommercial CC-BY-NC-4.0 weights** and require more memory and download time. Full inference for these larger models still needs validation on target hardware.
- Exported PNGs omit source metadata. Recipes are export-only, not reloadable projects.

See the [design document](perceptual_perspective_design.md) for geometry, architecture, evaluation, risks, and planned capabilities. It describes the broader direction; this browser-only POC implements crop and perceptual enhancement.

## Development

```sh
npm run build
npm test
```

With the app running and Windows Chrome installed:

- `node tests/browser.mjs` — browser checks with real inference; set `FORCE_CPU=1` to check CPU fallback.
- `node scripts/create-showcase.mjs` — regenerate the README images using app defaults.
