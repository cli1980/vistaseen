export const depthModels = [
  { id: 'onnx-community/depth-anything-v2-small', name: 'Depth Anything V2 Small', note: 'Fastest option and smallest download. A good starting point.', license: 'Apache-2.0' },
  { id: 'onnx-community/depth-anything-v2-base', name: 'Depth Anything V2 Base', note: 'Larger model to compare against Small. More memory and a longer first download.', license: 'CC-BY-NC-4.0 · Noncommercial use only' },
  { id: 'onnx-community/depth-anything-v2-large', name: 'Depth Anything V2 Large', note: 'Largest model and download. Most demanding on memory; CPU fallback can be very slow. Better results are not guaranteed.', license: 'CC-BY-NC-4.0 · Noncommercial use only' },
] as const;
export type DepthModelId = typeof depthModels[number]['id'];
export function getDepthModel(id: string) {
  const model = depthModels.find(model => model.id === id);
  if (!model) throw new Error('Unknown depth model. Please choose Small, Base, or Large.');
  return model;
}
