# Vistas As Seen — Perceptual Perspective Design

*Technical Design Document | v0.2 | 1 November 2026*

This revision describes the implemented browser POC. Future work is explicitly marked. It supersedes the v0.1 proposal for a server-backed editor and translated virtual camera. The [README](README.md) covers setup, deployment, and everyday use.

## 1. Purpose and scope

Help artists turn landscape photographs into useful painting references while retaining control over changes to the scene. Smartphone photos can make distant scenery feel less prominent than remembered; framing, projection, and viewing conditions contribute to this mismatch.

The camera stays at the original optical center. Users aim toward a different part of the photograph, and every output sample must remain inside the original image. Camera rotation reproduces a different viewing direction under the assumed camera model. Depth enhancement separately applies an artistic change to relative prominence.

The app does not reconstruct a 3D scene, move the camera, reveal hidden surfaces, generate fill, or claim to recover the exact experience of human vision. The 50 mm default is a framing choice, not an exact model of the human eye.

## 2. Implemented experience

Import JPEG, PNG, WebP, or browser-supported HEIC/HEIF → decode orientation and read equivalent focal length → position the target frame → optionally estimate depth → adjust and compare → export.

Defaults on a fresh app session:

- Camera rotation and depth enhancement are both enabled.
- Source focal length comes from valid EXIF, otherwise 24 mm. Target is 50 mm, raised to the source focal length if that is longer.
- Target position and enhancement anchor are centered; emphasis is 22%; Depth Anything V2 Small is selected.
- Depth estimation starts only when the user clicks its button. Until depth is available, the result uses the baseline rendering.
- The original working image appears above the results with a target outline and focal-length label. Click outside the frame to aim there, drag to move it, or use arrow keys; Shift increases the step.
- The labeled left view always disables depth while retaining the same camera framing. There is no baseline selector.

| Camera rotation | Depth enhancement | Baseline | Result after depth is available |
| --- | --- | --- | --- |
| On | On | Rotation only | Rotation + depth |
| Off | On | Crop only | Crop + depth |
| On | Off | Rotation only | Identical rotation-only view |
| Off | Off | Crop only | Identical crop-only view |

Blind comparison randomizes the two sides and hides labels and the original preview until revealed. Preferences can be recorded in the exported recipe. Pixel view displays the working-resolution renders with synchronized scrolling.

The depth-map display is grayscale, aligned with the selected framing before artistic enhancement. Confidence maps, false-color depth, and automatic structural protection are not implemented.

## 3. Camera geometry and frame containment

### Crop without rotation

For source equivalent focal length f and target f_t >= f, the crop's normalized width and height are s = f / f_t. Its origin is ((1-s) panX, (1-s) panY). The output retains the source aspect ratio and is resized to the working image dimensions.

For 24 mm to 50 mm, approximately 23% of the original area remains. This crop changes framing, not camera position or perspective. An off-center crop retains the original projection.

### Fixed-position rotation

The camera model assumes a rectilinear image, a centered principal point, square pixels, and diagonal 35 mm-equivalent focal lengths. For image width W and height H:

    f_px = f * hypot(W, H) / hypot(36, 24)

Use source and target intrinsics K_s and K_t with this convention. If R maps target-camera rays into source-camera coordinates, inverse sampling is:

    p_source ~ K_s R K_t^-1 p_target

There is no translation term and depth is not needed. The implementation aims the forward axis through the selected source point using yaw then pitch, with zero roll relative to the original camera convention. It does not estimate the physical horizon or correct residual lens distortion.

The target field of view stays fixed. When a requested direction would exceed the source image, a binary search limits the aim along the path from the original optical axis to that direction. All four projected corners must remain in bounds with positive ray denominators. The resulting convex quadrilateral contains the mapping of the whole output rectangle.

The outline is this source footprint. At the original optical axis, rotation is equivalent to crop/rescale. When source and target focal lengths are equal, the full-frame constraint permits no off-axis rotation. Rotation alone does not independently enlarge distant objects relative to nearby ones.

## 4. Artistic depth enhancement

### Depth representation

Depth Anything V2 supplies relative inverse depth, not measured distance. Keep Float32 values, normalized using the 2nd and 98th percentiles; larger values mean nearer. Flat maps become uniformly near and cause no enhancement. Invalid values are rejected. Rendering samples float depth directly, not the grayscale visualization.

There is no metric calibration, confidence estimation, sky mask, or edge refinement in the current POC.

### Warp

For normalized inverse depth n, emphasis e in [0, 0.4], and anchor a:

    far = 1 - clamp(n / 0.65, 0, 1)
    weight = far^2 * (3 - 2*far)
    scale = 1 + e * weight
    q_warped = a + (q - a) / scale

Sampling closer to the anchor enlarges distant regions. Near regions receive no displacement from this warp. This is an artistic inverse warp: it can bend structures or stretch boundaries and is not a physically reconstructed scene.

### Combining rotation and depth

Let H(q) denote the bounded inverse camera mapping from target coordinates to the original image. For each target pixel q:

1. Sample its aligned depth at H(q).
2. Compute the warp in target-view coordinates using that depth.
3. Sample the original RGB image at H(q_warped), with bilinear interpolation.

The composition samples RGB once per output pixel, avoiding a separately rasterized intermediate view. The anchor is in normalized rotated-target coordinates. Since scale >= 1 and the anchor lies inside the target rectangle, q_warped stays inside it; source sampling therefore stays within the bounded rotation footprint.

With rotation disabled, enhancement operates in original-image coordinates after selecting the crop, and the anchor refers to the original image. It can sample outside the crop rectangle but remains inside the original image. The outline always describes the baseline, not the exact depth-warped boundary.

Zero emphasis, missing depth, or uniformly near depth makes the enhanced result match its baseline.

## 5. Depth models and execution

The selectable models are ONNX-community conversions of Depth Anything V2:

| Variant | Role | Weight license |
| --- | --- | --- |
| Small | Default, smallest download | Apache-2.0 |
| Base | Larger comparison candidate | CC-BY-NC-4.0 |
| Large | Largest and most demanding candidate | CC-BY-NC-4.0 |

Transformers.js runs inference in a dedicated web worker. It attempts WebGPU with fp32 weights first; GPU availability, model-loading, or inference failures trigger one CPU/WASM attempt with q8 weights. WASM uses one thread. Larger models may exceed available memory, and better image results are not assumed.

A fresh worker is created for each estimation and terminated after completion, cancellation, or failure. Generation identifiers discard stale results. Switching models or importing another photo clears the current depth result. Framing and emphasis changes reuse the current image's depth without inference. There is no application-level, multi-image depth cache; model resources may be cached by the inference library/browser.

Progress reports weight-file bytes and percentages when available, distinguishes runtime preparation, and reports 30 seconds without an update. This is an informational message, not an automatic download timeout.

Small-model GPU inference and CPU fallback have browser checks. Full Base/Large inference still requires validation on target hardware.

## 6. Architecture, deployment, and privacy

Current implementation:

- React + TypeScript UI, exifr metadata parsing, and Vite static build.
- Browser-local image decoding and depth estimation.
- CPU bilinear pixel rendering on the main thread, presented through Canvas 2D. GPU acceleration currently applies to depth inference, not the correction renderer.
- In-memory photo, depth, settings, and preference state. Refreshing or closing the page loses the session.

There is no application backend, upload API, database, Python service, or server GPU requirement. Photos stay on the device. Network requests fetch application assets, model weights, and runtime resources; the deployed app must be able to reach the relevant external hosts.

The default build uses relative asset paths and base-aware home/notice links, allowing deployment at the site root or an app subfolder. Serve over HTTPS for browser GPU support, and retain the generated LICENSE.txt and NOTICE.txt. Dependencies and model weights retain their own licenses; Apache-2.0 for the project does not change the Base/Large restrictions.

## 7. Working limits and exports

| Item | Current behavior |
| --- | --- |
| Import | Reject files over 40 MiB and decoded images over 80 megapixels |
| Working image | Downsize to at most 1600 px on the long edge |
| Normal preview | At most 900 px on the long edge |
| Pixel view and PNG export | Working resolution, not original full resolution |
| Output framing | Same aspect ratio as the source; no wider-than-source target FOV |
| Image export | PNG from the working canvas, without source EXIF |
| Edit recipe | Export-only JSON; no project reload or session persistence |

Recipe version 3 records the source hash, original/working dimensions, selected effects, baseline, anchor coordinate space, renderer identifier, settings, preference, and—when rotation is active—yaw, pitch, zero translation, source footprint, and camera convention. When depth is enabled and available, it also includes the float depth array, normalization, model, backend, dtype, inference timing, and any fallback reason.

Recipes are diagnostic edit records, not a guarantee of bit-identical inference across devices or future model revisions.

## 8. Existing showcase versus current defaults

The README images and version-1 settings capture document an earlier depth-only comparison: crop versus depth warp, at 50 mm with 22% emphasis, a centered anchor, and the Small model. They do not illustrate off-axis camera rotation or the current default combined mode.

The showcase script deliberately disables rotation to reproduce that comparison. The README identifies its settings separately from current app defaults. New exports use recipe version 3; the historical capture is not silently rewritten.

## 9. Validation and proposed success criteria

Existing automated checks cover camera mapping and bounds, zero-strength identity, aligned depth composition, GPU-to-CPU fallback, progress formatting, and model selection. Browser checks cover frame interaction, comparison labels and preferences, PNG/recipe export, mobile layout, and real Small-model inference. A production-subfolder smoke check also verified asset/notice loading and GPU inference.

These checks establish implementation behavior, not artistic quality or scene accuracy. Proposed evaluation:

- Use 30–50 owned photos spanning mountains, skylines, foliage, interiors, and strong foreground/background separation.
- Compare rotation-only against rotation + depth at identical framing; separately compare crop-only against crop + depth.
- Assess calibration and straight-line preservation for rotation, then measure additional bending, boundary stretching, foreground displacement, and distant-subject prominence caused by enhancement.
- Record blind preference, naturalness, severe-artifact rate, and inference/render latency on target hardware.
- Use measured depth where available to evaluate model quality; do not treat a plausible grayscale depth map as proof of a better final image.

The earlier proposed quality gate—70% preference for enhancement with severe artifacts in no more than 10% of images—remains an unvalidated product target, not an achieved result.

## 10. Proposed improvements and excluded approaches

Potential improvements, none implied to exist today:

- Lens calibration/undistortion and clearer handling of uncertain source focal length.
- Segmentation, straight-line/rigid-object constraints, and depth-boundary refinement.
- Better depth-model comparisons, subject to checkpoint licenses and deployment feasibility.
- GPU or worker-based rendering, full-resolution exports, recipe import, persistent sessions, and batch processing.
- A structured user study of the artistic benefit.

Depth Anything 3, MoGe, Depth Pro, and Metric3D remain research candidates rather than shipped alternatives. Recheck exact checkpoint licenses, runtime support, and resulting image quality before integration.

Camera translation, 3D scene reconstruction, server inference, and generative filling are outside the current fixed-position scope. The v0.1 translation formula, depth API contracts, backend plan, and associated milestones were exploratory proposals, not implemented features or current requirements. Any future scope change would need a separate design.

## 11. Main risks and open questions

| Risk | Current handling or limitation |
| --- | --- |
| Incorrect camera intrinsics | EXIF/default estimate with manual focal-length override; no full calibration |
| Target exits source coverage | Limit rotation at fixed target focal length |
| Depth warp bends structures | Bounded emphasis and visible comparison; no object/line constraints yet |
| Thin branches, sky, reflections | Model-dependent quality; no dedicated masks |
| GPU unsupported or fails | One CPU/WASM fallback attempt |
| Model download stalls | Byte progress, inactivity feedback, cancellation, and manual retry |
| Large model memory/runtime cost | Small default; larger variants need validation |
| Unproven perceptual benefit | Blind comparison and proposed broader evaluation |

Open questions concern the best balance of artistic prominence and geometric fidelity, which constraints help without excessive complexity, and performance across supported browsers and devices. Fixed camera position, in-frame source sampling, local processing, and no generated fill are current decisions.

## References and implementation pointers

- [Geometry and rendering](src/geometry.ts)
- [UI, defaults, and exports](src/main.tsx)
- [Depth worker](src/depth.worker.ts), [model catalog](src/models.ts)
- [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2)
- [OpenCV camera calibration](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)
- [OpenCV homography explanation](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)
