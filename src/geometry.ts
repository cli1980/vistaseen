export type Depth = { data: Float32Array; width: number; height: number };
export type Settings = { source: number; target: number; panX: number; panY: number; anchorX: number; anchorY: number; strength: number };
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function crop(s: Settings) {
  const size = Math.min(1, s.source / s.target);
  return { size, x: (1 - size) * s.panX, y: (1 - size) * s.panY };
}
export type Point = [number, number];
// Equivalent focal length uses the full-frame diagonal. Both views retain the
// source aspect ratio and assume a rectilinear image with a centered principal point.
export function rotationFrame(s: Settings, width: number, height: number) {
  const diagonal = Math.hypot(36, 24);
  const sensorX = diagonal * width / Math.hypot(width, height);
  const sensorY = diagonal * height / Math.hypot(width, height);
  const c = crop(s), desired: Point = [c.x + c.size / 2, c.y + c.size / 2];
  const target = Math.max(s.source, s.target);
  const make = (fraction: number) => {
    const center: Point = [.5 + (desired[0] - .5) * fraction, .5 + (desired[1] - .5) * fraction];
    const dx = (center[0] - .5) * sensorX / s.source, dy = (center[1] - .5) * sensorY / s.source;
    const length = Math.hypot(dx, dy, 1);
    const forward = [dx / length, dy / length, 1 / length];
    // Yaw then pitch, with zero roll relative to the original camera's up axis.
    const horizontal = Math.hypot(forward[0], forward[2]);
    const right = [forward[2] / horizontal, 0, -forward[0] / horizontal];
    const down = [-forward[1] * forward[0] / horizontal, horizontal, -forward[1] * forward[2] / horizontal];
    const ray = (u: number, v: number) => {
      const x = (u - .5) * sensorX / target, y = (v - .5) * sensorY / target;
      return [right[0] * x + down[0] * y + forward[0], down[1] * y + forward[1], right[2] * x + down[2] * y + forward[2]];
    };
    const map = (u: number, v: number): Point => {
      if (dx === 0 && dy === 0) return [(1 - c.size) / 2 + u * c.size, (1 - c.size) / 2 + v * c.size];
      const [x, y, z] = ray(u, v);
      return [.5 + s.source * x / (sensorX * z), .5 + s.source * y / (sensorY * z)];
    };
    const corners = ([ [0, 0], [1, 0], [1, 1], [0, 1] ] as Point[]).map(([u, v]) => map(u, v));
    // A projective mapping with positive corner denominators maps the entire
    // rectangle into its convex corner polygon, so these bounds cover every pixel.
    const valid = corners.every(([u, v]) => u >= -1e-12 && u <= 1 + 1e-12 && v >= -1e-12 && v <= 1 + 1e-12)
      && ([ [0, 0], [1, 0], [1, 1], [0, 1] ] as Point[]).every(([u, v]) => ray(u, v)[2] > 0);
    return { map, corners, center, valid, yaw: Math.atan2(dx, 1) * 180 / Math.PI, pitch: -Math.atan2(dy, Math.hypot(dx, 1)) * 180 / Math.PI };
  };
  let frame = make(1);
  const limited = !frame.valid;
  if (limited) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (make(mid).valid) lo = mid; else hi = mid;
    }
    frame = make(lo);
  }
  const room = 1 - c.size;
  const fitted = { ...s, panX: room > 0 ? clamp((frame.center[0] - c.size / 2) / room) : .5, panY: room > 0 ? clamp((frame.center[1] - c.size / 2) / room) : .5 };
  return { ...frame, limited, settings: fitted };
}
export function sample(d: Depth, u: number, v: number) {
  const x = clamp(u) * (d.width - 1), y = clamp(v) * (d.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, d.width - 1), y1 = Math.min(y0 + 1, d.height - 1);
  const a = x - x0, b = y - y0;
  return (d.data[y0*d.width+x0]*(1-a)+d.data[y0*d.width+x1]*a)*(1-b)+(d.data[y1*d.width+x0]*(1-a)+d.data[y1*d.width+x1]*a)*b;
}
export function normalizeDepth(values: Float32Array): Float32Array {
  if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error('Model returned invalid depth values.');
  const ordered = Float32Array.from(values).sort();
  const lo = ordered[Math.floor(ordered.length * .02)], hi = ordered[Math.floor((ordered.length - 1) * .98)];
  if (hi - lo < 1e-6) return new Float32Array(values.length).fill(1);
  return Float32Array.from(values, v => clamp((v - lo) / (hi - lo)));
}
// Inverse sampling: near pixels stay fixed; far pixels sample closer to the anchor,
// enlarging distant scenery. This is intentionally a perceptual warp, not reprojection.
function emphasisScale(near: number, strength: number) {
  const far = 1 - clamp(near / .65);
  const weight = far * far * (3 - 2 * far);
  return 1 + clamp(strength, 0, .4) * weight;
}
export function sourcePoint(u: number, v: number, depth: Depth | null, s: Settings): [number, number] {
  if (!depth || s.strength === 0) return [u, v];
  const scale = emphasisScale(sample(depth, u, v), s.strength);
  return [s.anchorX + (u - s.anchorX) / scale, s.anchorY + (v - s.anchorY) / scale];
}
export function rotatedSourcePoint(u: number, v: number, frame: Pick<ReturnType<typeof rotationFrame>, 'map'>, depth: Depth | null, s: Settings): Point {
  const point = frame.map(u, v);
  if (!depth || s.strength === 0) return point;
  // Evaluate depth in the rotated view, then compose the inverse artistic warp
  // with camera rotation. Sample original RGB once to avoid two resampling passes.
  const scale = emphasisScale(sample(depth, ...point), s.strength);
  const ax = clamp(s.anchorX), ay = clamp(s.anchorY);
  // scale >= 1 keeps the warped point between the output pixel and its anchor.
  // Both are inside the target frame, whose whole footprint is inside the source.
  return frame.map(ax + (u - ax) / scale, ay + (v - ay) / scale);
}
export function renderPixels(source: ImageData, depth: Depth | null, s: Settings, width: number, height: number, showDepth = false, mode: 'crop' | 'rotation' | 'rotation-depth' = 'crop') {
  const out = new Uint8ClampedArray(width * height * 4), c = crop(s);
  const rotation = mode !== 'crop' ? rotationFrame(s, source.width, source.height) : null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [u, v] = rotation ? rotation.map((x + .5) / width, (y + .5) / height) : [c.x + (x + .5) / width * c.size, c.y + (y + .5) / height * c.size];
    const i = (y * width + x) * 4;
    if (mode !== 'rotation' && showDepth && depth) {
      const t = sample(depth, u, v); out[i] = out[i+1] = out[i+2] = t*255; out[i+3] = 255; continue;
    }
    const [su, sv] = rotation ? mode === 'rotation-depth' ? rotatedSourcePoint((x + .5) / width, (y + .5) / height, rotation, depth, s) : [u, v] : sourcePoint(u, v, depth, s);
    const px = clamp(su * source.width - .5, 0, source.width-1), py = clamp(sv * source.height - .5, 0, source.height-1);
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(x0+1, source.width-1), y1 = Math.min(y0+1, source.height-1);
    const a = px-x0, b = py-y0;
    for (let k = 0; k < 4; k++) out[i+k] = (source.data[(y0*source.width+x0)*4+k]*(1-a)+source.data[(y0*source.width+x1)*4+k]*a)*(1-b)+(source.data[(y1*source.width+x0)*4+k]*(1-a)+source.data[(y1*source.width+x1)*4+k]*a)*b;
  }
  return out;
}
