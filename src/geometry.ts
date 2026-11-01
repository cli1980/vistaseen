export type Depth = { data: Float32Array; width: number; height: number };
export type Settings = { source: number; target: number; panX: number; panY: number; anchorX: number; anchorY: number; strength: number };
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export function crop(s: Settings) {
  const size = Math.min(1, s.source / s.target);
  return { size, x: (1 - size) * s.panX, y: (1 - size) * s.panY };
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
export function sourcePoint(u: number, v: number, depth: Depth | null, s: Settings): [number, number] {
  if (!depth || s.strength === 0) return [u, v];
  const near = sample(depth, u, v);
  const far = 1 - clamp(near / .65);
  const weight = far * far * (3 - 2 * far);
  const scale = 1 + clamp(s.strength, 0, .4) * weight;
  return [s.anchorX + (u - s.anchorX) / scale, s.anchorY + (v - s.anchorY) / scale];
}
export function renderPixels(source: ImageData, depth: Depth | null, s: Settings, width: number, height: number, showDepth = false) {
  const out = new Uint8ClampedArray(width * height * 4), c = crop(s);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = c.x + (x + .5) / width * c.size, v = c.y + (y + .5) / height * c.size;
    const i = (y * width + x) * 4;
    if (showDepth && depth) {
      const t = sample(depth, u, v); out[i] = out[i+1] = out[i+2] = t*255; out[i+3] = 255; continue;
    }
    const [su, sv] = sourcePoint(u, v, depth, s);
    const px = clamp(su * source.width - .5, 0, source.width-1), py = clamp(sv * source.height - .5, 0, source.height-1);
    const x0 = Math.floor(px), y0 = Math.floor(py), x1 = Math.min(x0+1, source.width-1), y1 = Math.min(y0+1, source.height-1);
    const a = px-x0, b = py-y0;
    for (let k = 0; k < 4; k++) out[i+k] = (source.data[(y0*source.width+x0)*4+k]*(1-a)+source.data[(y0*source.width+x1)*4+k]*a)*(1-b)+(source.data[(y1*source.width+x0)*4+k]*(1-a)+source.data[(y1*source.width+x1)*4+k]*a)*b;
  }
  return out;
}
