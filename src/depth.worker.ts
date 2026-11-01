import { pipeline, env, RawImage } from '@huggingface/transformers';
import { normalizeDepth } from './geometry';
import { gpuWithCpuFallback } from './inference';
import { getDepthModel } from './models';
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
let estimator: any;
let loadedModel: string | undefined;
let backend: 'webgpu' | 'wasm' | undefined;
let fallbackReason: string | undefined;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
async function dispose() {
  try { await estimator?.dispose(); } catch { /* Release what remains after a lost GPU device. */ }
  estimator = undefined;
  backend = undefined;
  loadedModel = undefined;
}
self.onmessage = async (event: MessageEvent) => {
  const { id, pixels, width, height, modelId } = event.data;
  const progress = (message: string) => self.postMessage({ id, type: 'progress', message });
  try {
    const model = getDepthModel(modelId).id;
    if (loadedModel !== model) { await dispose(); fallbackReason = undefined; }
    const input = new RawImage(new Uint8ClampedArray(pixels), width, height, 4);
    async function run(device: 'webgpu' | 'wasm') {
      const label = device === 'webgpu' ? 'GPU' : 'CPU fallback';
      if (!estimator) {
        progress(`Preparing ${label} depth model…`);
        estimator = await pipeline('depth-estimation', model, {
          device, dtype: device === 'webgpu' ? 'fp32' : 'q8',
          progress_callback: (p: any) => progress(p.status === 'progress' ? `${label} · downloading model · ${Math.round(p.progress ?? 0)}%` : `Preparing ${label} depth model…`),
        });
        backend = device;
        loadedModel = model;
      }
      progress(`Estimating depth locally on ${label}${device === 'wasm' ? '… This can take a minute.' : '…'}`);
      const started = performance.now();
      const result = await estimator(input);
      const tensor = result.predicted_depth;
      const data = normalizeDepth(Float32Array.from(tensor.data));
      return { data, width: tensor.dims.at(-1), height: tensor.dims.at(-2), inferenceMs: Math.round(performance.now() - started) };
    }
    const result = backend === 'wasm' ? await run('wasm') : await gpuWithCpuFallback(async () => {
      if (!estimator) {
        progress('Checking GPU availability…');
        const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(options: { powerPreference: string }): Promise<unknown> } }).gpu;
        if (!gpu || !await gpu.requestAdapter({ powerPreference: 'high-performance' })) throw new Error('WebGPU is unavailable in this browser or device.');
      }
      return await run('webgpu');
    }, () => run('wasm'), async error => {
      fallbackReason = messageOf(error);
      progress('GPU unavailable or failed · switching to CPU…');
      await dispose();
    });
    self.postMessage({ id, type: 'result', ...result, model, backend, dtype: backend === 'webgpu' ? 'fp32' : 'q8', fallbackReason });
  } catch (error) {
    await dispose();
    self.postMessage({ id, type: 'error', message: messageOf(error) });
  }
};
