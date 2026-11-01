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
