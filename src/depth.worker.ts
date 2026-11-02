import { pipeline, env, RawImage } from '@huggingface/transformers';
import { normalizeDepth } from './geometry';
import { formatModelProgress, gpuWithCpuFallback } from './inference';
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
  let lastMessage = 'Preparing depth estimation…', lastUpdate = Date.now();
  const progress = (message: string) => {
    lastMessage = message; lastUpdate = Date.now();
    self.postMessage({ id, type: 'progress', message });
  };
  const waiting = setInterval(() => {
    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds >= 30) self.postMessage({ id, type: 'progress', message: `${lastMessage} · No progress update for ${seconds}s. You can cancel and retry; if downloading, check access to Hugging Face on your network.` });
  }, 5000);
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
          progress_callback: (p: any) => {
            const message = formatModelProgress(p, label);
            if (message) progress(message);
          },
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
  } finally {
    clearInterval(waiting);
  }
};
