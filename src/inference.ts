// The GPU attempt includes both model loading and inference, so either failure
// retries the same image once on CPU. CPU failures propagate to the UI.
export async function gpuWithCpuFallback<T>(gpu: () => Promise<T>, cpu: () => Promise<T>, onFallback: (error: unknown) => Promise<void>) {
  try {
    return await gpu();
  } catch (error) {
    await onFallback(error);
    return await cpu();
  }
}

type LoadProgress = { status: string; file?: string; loaded?: number; total?: number; progress?: number };
const sizeLabel = (bytes: number) => bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
export function formatModelProgress(event: LoadProgress, label: string): string | null {
  // Transformers emits aggregate and per-file updates together. Use the weight
  // file only so tiny config downloads cannot reset the visible model progress.
  if (event.status === 'ready') return `${label} model ready`;
  if (!event.file?.includes('.onnx')) return null;
  if (event.status === 'initiate') return `${label} · connecting to Hugging Face for model weights…`;
  if (event.status === 'download') return `${label} · downloading model weights…`;
  if (event.status === 'done') return `${label} model weights loaded · preparing runtime…`;
  if (event.status !== 'progress') return null;
  const loaded = event.loaded, total = event.total;
  if (typeof loaded === 'number' && Number.isFinite(loaded) && loaded >= 0) {
    if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
      const percent = Math.min(100, loaded / total * 100);
      const percentage = percent > 0 && percent < 1 ? '<1' : Math.floor(percent).toString();
      return `${label} · downloading model · ${percentage}% · ${sizeLabel(loaded)} / ${sizeLabel(total)}`;
    }
    return `${label} · downloading model · ${sizeLabel(loaded)} received · total size unavailable`;
  }
  return `${label} · downloading model · waiting for transfer details…`;
}
