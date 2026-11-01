# Perceptual Perspective Correction

*Technical Design Document  |  v0.1  |  31 October 2026*

A depth-aware photo editor that makes distant scenery more prominent in smartphone photographs while preserving plausible scene geometry.

## 1. Executive summary

Problem: smartphone wide-angle photos often make distant mountains, landmarks, and skyline elements feel smaller than remembered. This is largely a field-of-view, framing, and viewing-condition mismatch—not a generic lens distortion defect. The product must distinguish optically faithful crop from deliberately perceptual, depth-dependent enhancement.

Proposal: a browser-based TypeScript editor backed by a pluggable GPU depth-inference service. Users upload a photograph, inspect its depth map, and compare three modes: (A) crop-only focal-length simulation, (B) virtual-camera reprojection, and (C) conservative depth-aware background emphasis. The original is always retained.

## 2. Goals and non-goals

### Goals

- Improve the perceived prominence of distant scenery without obviously bending foreground objects.
- Provide transparent, adjustable controls and a before/after comparison.
- Use float depth maps with camera calibration and reproducible rendering.
- Operate on a single ordinary smartphone photograph; support optional richer inputs later.
### Non-goals

- Recover the exact perceptual experience of human vision.
- Infer reliable kilometer-scale metric distances from any single image.
- Guarantee physically correct novel viewpoints where source pixels are occluded.
- Claim the enhanced result is an unaltered documentary photograph.
## 3. User experience and functional requirements

Workflow: import JPEG/HEIC (where browser decoding permits) → extract EXIF → orient and undistort → estimate depth → inspect depth overlay → select correction mode → adjust sliders → inspect artifacts → export image and optional edit recipe.

| Priority | Requirement | Acceptance criterion |
| --- | --- | --- |
| P0 | Photo import + EXIF | Orientation and equivalent focal length interpreted; manual override available |
| P0 | 50mm crop baseline | Deterministic crop with pan and no invented content |
| P0 | Depth inspection | Grayscale/false-color depth overlay, confidence warnings |
| P0 | Depth-aware preview | Interactive quality preview; non-destructive controls |
| P0 | Before/after | Synchronized split-view and 100% zoom |
| P1 | Virtual-camera mode | Adjust translation and target FOV; highlight disocclusions |
| P1 | Perceptual mode | Depth-based emphasis with edge preservation and strength limit |
| P1 | Export | Full-resolution PNG/JPEG and JSON recipe |
| P2 | Batch processing | Queue photos with model/version metadata |

## 4. Geometry and correction modes

### A. Optical baseline: same-position crop

For rectilinear images, a change from source equivalent focal length f to target f_t at the same camera position is a crop/rescale with factor f_t/f. It changes framing, not perspective. For 24mm to 50mm, the linear crop factor is 2.083 and approximately 23% of the original image area remains.

### B. Virtual camera translation

Back-project pixels with P = Z K⁻¹p, transform to P′ = RP + t, then project p′ ~ K′P′. Under a simplified backward translation d and focal multiplier a = f′/f, the local scale ratio is M(Z) = a Z/(Z+d). This can reduce relative foreground magnification while preserving more background prominence. Use z-buffered forward splatting or mesh rasterization, edge-aware interpolation, and explicit hole masks.

### C. Perceptual depth-aware emphasis

Apply a bounded smooth scale field conditioned on depth, with foreground anchor regions and a user-selected distant-subject anchor. This is an artistic warp, not a physically exact camera simulation. Constrain displacement gradients and line curvature; segment important objects to avoid shearing them. Offer an honest “perceptual enhancement” label.

### Depth representation

Store linear float32 metric depth when available, otherwise inverse/relative depth plus scale ambiguity metadata. Never perform geometry on an 8-bit colorized depth preview. Sky and low-confidence pixels receive special handling; for far scenery, a large-depth/infinity approximation is often sufficient.

## 5. Model selection and evaluation

Benchmark Depth Anything 3 metric-capable variants, Apple Depth Pro, and Metric3D V2. Treat these as candidate families, not as a settled ranking. Verify exact checkpoint availability, licenses, memory requirements, input focal-length assumptions, and supported deployment runtimes before choosing a production model.

| Candidate | Why evaluate | Key concern |
| --- | --- | --- |
| Depth Anything 3 | Strong general depth / multi-view family | Variant-specific metric behavior and deployment cost |
| Apple Depth Pro | Metric-oriented output and sharp boundaries | Compute and license/deployment constraints |
| Metric3D V2 | Metric geometry and normals | Camera-intrinsic assumptions and domain shift |
| Depth Anything V2 Small | Fast browser baseline | Relative depth and lower geometric fidelity |

Evaluation set: 30–50 owned photos covering mountains, urban skylines, trees, portraits, interiors, backlit scenes, and sky. Manually mark depth discontinuities, horizon, straight lines, and foreground anchors. Compare resulting image quality—not just depth-map aesthetics.

## 6. System architecture

Frontend: React + TypeScript, exifr, Canvas/WebGL2/WebGPU, Three.js or a custom GPU rasterizer. Backend: Python FastAPI inference service with GPU workers and model adapters. Storage: local-first image session; short-lived inference uploads by default, no retained originals unless explicitly opted in.

Pipeline: image decode → EXIF/orientation → intrinsic estimation and optional undistortion → normalized inference input → depth + uncertainty → edge-aware depth refinement → correction renderer → hole detection / optional inpainting → export.

### Suggested API contracts

POST /v1/depth: multipart image, model_id, optional intrinsics → job_id. GET /v1/jobs/{id} → status and model/version. GET /v1/jobs/{id}/result → float depth (EXR or lossless binary), confidence, valid mask, intrinsics, depth_type, units, image dimensions. POST /v1/render (optional server fallback) → output and diagnostics.

Persist an edit recipe containing source hash, source and target intrinsics, model/version, depth units, camera transform, warp parameters, crop, and renderer version for reproducibility.

## 7. Core implementation details

- Camera intrinsics: derive initial focal length in pixels from EXIF equivalent focal length and image dimensions; correct for sensor crop and orientation. Allow manual calibration when EXIF is missing.
- Model preprocessing: track resize, padding, and crop transforms; invert them when mapping predicted depth back to source coordinates.
- Depth refinement: bilateral/guided refinement near image edges; avoid blindly snapping every color edge to a depth edge.
- Rendering: z-buffer for visibility, antialiasing, robust mesh triangles near depth jumps, optional tiled processing for high-resolution photos.
- Occlusions: visualize newly exposed holes; default to conservative crop or local interpolation; optional inpainting is clearly disclosed.
- Quality controls: cap per-pixel displacement, preserve straight structures, mask sky, provide foreground-lock and background-anchor tools.
## 8. Performance and privacy

Target: smooth adjustment of cached depth at reduced preview resolution on a modern desktop GPU; final export may take longer. Do not promise specific latency before profiling. Cache depth by image hash and model version. Support worker-based image processing to keep the UI responsive. Validate maximum upload size and decompression dimensions; strip GPS metadata from exports by default. State explicitly when images are sent to a server.

## 9. Validation and success metrics

| Metric | Proposed test |
| --- | --- |
| Preference | Blind A/B: original vs crop vs reprojection vs perceptual mode |
| Naturalness | 5-point human rating; report mean and disagreement |
| Structure preservation | Straight-line deviation and foreground landmark displacement |
| Artifact rate | Fraction with visible halos, seams, holes or stretched objects |
| Depth quality | Boundary alignment; metric error where reference depth exists |
| Performance | p50/p95 inference and render latency on target hardware |

Release gate for perceptual mode: at least 70% of test participants prefer the corrected image for distant-object prominence, with no more than 10% of evaluated images showing severe visible geometric artifacts. These are proposed product thresholds, not established empirical results.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Monocular scale ambiguity | Calibrate with known-size anchors; avoid meter labels without confidence |
| Sky / far-distance saturation | Infinity-depth handling; semantic masks |
| Occluded pixels | Hole mask and conservative transform; optional disclosed inpainting |
| Warped buildings / people | Segmentation and rigid-object constraints; strength limits |
| Model hallucination / bias | Compare models and expose uncertainty; preserve original |
| Browser GPU incompatibility | WebGL2 fallback or server render; capability detection |
| Third-party model licensing | Review weights and commercial terms before distribution |

## 11. Milestones

| Phase | Deliverable | Indicative effort |
| --- | --- | --- |
| 0 — Research | Image set, model benchmark, geometry proof-of-concept | 1–2 weeks |
| 1 — MVP | Import, EXIF, crop, depth API, depth preview, GPU renderer | 2–4 weeks |
| 2 — Quality | Edge handling, hole masks, interactive controls, export | 2–4 weeks |
| 3 — Pilot | User study, tuning, mobile optimization, privacy review | 2–3 weeks |

Estimates are rough single-experienced-developer planning ranges, contingent on GPU availability and model integration. Work can overlap.

## 12. Open decisions

- Primary platform: desktop browser first, or mobile Safari first?
- Is server-side GPU inference acceptable, or is on-device privacy mandatory?
- Should the default optimize landscape perception, or work equally for portraits and interiors?
- Should inpainting be prohibited in the first release to preserve documentary fidelity?
- What is the reference standard: subjective preference, geometric fidelity, or a balanced combination?
## 13. Initial engineering recommendation

Build an offline comparison harness before the full UI. For each test image, compute depth with two candidate models and generate (1) crop-only, (2) virtual-camera translation, and (3) bounded perceptual warp. Record visual preference, structural artifacts, inference cost, and model failures. Select the model and default transform using corrected-image outcomes. The first milestone is evidence that depth-aware correction improves on crop-only—not merely a convincing depth visualization.

## References and starting points

Depth Anything 3: https://github.com/ByteDance-Seed/Depth-Anything-3

Apple Depth Pro: https://github.com/apple/ml-depth-pro

Metric3D: https://github.com/YvanYin/Metric3D

Depth Anything V2: https://github.com/DepthAnything/Depth-Anything-V2

Three.js: https://threejs.org/

OpenCV camera calibration: https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html
