import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import exifr from 'exifr';
import { clamp, crop, rotationFrame, renderPixels, type Depth, type Settings } from './geometry';
import './style.css';
import { depthModels, getDepthModel, type DepthModelId } from './models';

const defaults: Settings = { source: 24, target: 50, panX: .5, panY: .5, anchorX: .5, anchorY: .5, strength: .22 };
type Comparison = 'crop' | 'rotation' | 'depth' | 'combined';
const viewNames: Record<Comparison, string> = { crop: 'Crop only', rotation: 'Camera rotation', depth: 'Crop + perspective', combined: 'Rotation + depth' };
function App() {
  const [rotationEnabled, setRotationEnabled] = useState(true), [depthEnabled, setDepthEnabled] = useState(true);
  const comparison: Comparison = rotationEnabled ? depthEnabled ? 'combined' : 'rotation' : depthEnabled ? 'depth' : 'crop';
  const baselineMode = rotationEnabled ? 'rotation' : 'crop';
  const [modelId, setModelId] = useState<DepthModelId>(depthModels[0].id);
  const selectedModel = getDepthModel(modelId);
  const [photo, setPhoto] = useState<ImageData | null>(null), [depth, setDepth] = useState<Depth | null>(null);
  const [settings, setSettings] = useState(defaults), [name, setName] = useState(''), [status, setStatus] = useState('Ready for your first photo');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [overlay, setOverlay] = useState(false), [zoom, setZoom] = useState(false);
  const [blind, setBlind] = useState(false), [reverse, setReverse] = useState(false), [vote, setVote] = useState('');
  const original = useRef<HTMLCanvasElement>(null), left = useRef<HTMLCanvasElement>(null), right = useRef<HTMLCanvasElement>(null), worker = useRef<Worker | null>(null), generation = useRef(0);
  const inferenceInfo = useRef<{ model: string; backend: string; dtype: string; inferenceMs: number; fallbackReason?: string } | null>(null);
  const imageHash = useRef(''), originalSize = useRef([0, 0]);
  const cropDrag = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const rotation = photo ? rotationFrame(settings, photo.width, photo.height) : null;
  const activeSettings = rotationEnabled && rotation ? rotation.settings : settings;
  const comparisonReady = !!photo && (!depthEnabled || !!depth);
  const fit = (s: Settings) => rotationEnabled && photo ? rotationFrame(s, photo.width, photo.height).settings : s;
  function setEffects(rotate: boolean, enhance: boolean) {
    setRotationEnabled(rotate); setDepthEnabled(enhance); setBlind(false); setOverlay(false); setVote('');
    if (rotate && photo) setSettings(s => rotationFrame(s, photo.width, photo.height).settings);
  }
  function renderView(selected: boolean, width: number, height: number, showDepth = false) {
    const mode = selected ? comparison : baselineMode;
    return renderPixels(photo!, mode === 'depth' || mode === 'combined' ? depth : null, activeSettings, width, height, showDepth,
      mode === 'combined' ? 'rotation-depth' : mode === 'rotation' ? 'rotation' : 'crop');
  }
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!photo || !original.current) return;
    original.current.width = photo.width;
    original.current.height = photo.height;
    original.current.getContext('2d')!.putImageData(photo, 0, 0);
  }, [photo, blind]);
  const change = (key: keyof Settings, value: number) => { setSettings(s => fit({ ...s, [key]: value })); setVote(''); };
  async function load(file: File) {
    const id = ++generation.current;
    inferenceInfo.current = null;
    worker.current?.terminate(); worker.current = null;
    setBusy(false); setError(''); setDepth(null); setPhoto(null); setVote(''); setBlind(false); setOverlay(false); setStatus('Opening photo…');
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error('Please choose a photo smaller than 40 MB.');
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width * bitmap.height > 80_000_000) { bitmap.close(); throw new Error('Please use a photo under 80 megapixels.'); }
      originalSize.current = [bitmap.width, bitmap.height];
      const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio);
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const meta = await exifr.parse(file, ['FocalLengthIn35mmFilm']).catch(() => null);
      const focal = Number(meta?.FocalLengthIn35mmFilm);
      const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      if (id !== generation.current) return;
      imageHash.current = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('');
      const source = Number.isFinite(focal) && focal >= 8 && focal <= 200 ? focal : 24;
      setSettings({ ...defaults, source, target: Math.max(50, source) }); setName(file.name); setPhoto(ctx.getImageData(0, 0, canvas.width, canvas.height));
      setStatus(`Photo ready · ${focal === source ? 'EXIF focal length detected' : 'Assuming 24 mm; adjust source focal length if needed'}`);
    } catch (e) { if (id === generation.current) { setError(`Could not open photo. ${e instanceof Error ? e.message : e} Try JPEG, PNG, or WebP.`); setStatus('Import failed'); } }
  }
  function selectModel(id: DepthModelId) {
    if (id === modelId) return;
    ++generation.current;
    worker.current?.terminate(); worker.current = null;
    inferenceInfo.current = null;
    setModelId(id); setDepth(null); setBusy(false); setError(''); setVote(''); setBlind(false); setOverlay(false);
    setStatus(`${getDepthModel(id).name} selected · estimate depth to compare`);
  }
  function estimate() {
    if (!photo || busy) return;
    setBusy(true); setError(''); setStatus(`Loading ${selectedModel.name}… First run downloads model weights.`);
    const id = ++generation.current;
    worker.current?.terminate();
    const w = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' }); worker.current = w;
    const isCurrent = () => id === generation.current && worker.current === w;
    const release = () => { w.terminate(); if (worker.current === w) worker.current = null; };
    w.onmessage = ({ data }) => {
      if (!isCurrent() || data.id !== id) return;
      if (data.type === 'progress') setStatus(data.message);
      else if (data.type === 'result') { setDepth({ data: data.data, width: data.width, height: data.height }); setBusy(false); inferenceInfo.current = { model: data.model, backend: data.backend, dtype: data.dtype, inferenceMs: data.inferenceMs, fallbackReason: data.fallbackReason }; setStatus(`Depth ready · ${getDepthModel(data.model).name} · ${data.backend === 'webgpu' ? 'GPU' : 'CPU fallback'} · ${(data.inferenceMs / 1000).toFixed(1)}s inference · relative depth, not measured distance`); }
      else { setBusy(false); setError(`Depth estimation failed: ${data.message}. Retry to start a fresh session. Larger models may exceed available memory; try Small if needed.`); setStatus('Crop-only is still available'); }
      if (data.type !== 'progress') release();
    };
    w.onerror = e => {
      if (isCurrent()) {
        setBusy(false);
        setError(`Depth worker failed: ${e.message || 'The worker could not load or stopped unexpectedly.'} Check that the local app server is running, then retry. If this persists with Base or Large, try Small.`);
        setStatus('Depth estimation stopped · retry available');
      }
      release();
    };
    w.postMessage({ id, modelId, pixels: photo.data, width: photo.width, height: photo.height });
  }
  useEffect(() => {
    if (!photo) return;
    const handle = requestAnimationFrame(() => {
      const scale = Math.min(1, (zoom ? 1600 : 900) / Math.max(photo.width, photo.height));
      const width = Math.round(photo.width * scale), height = Math.round(photo.height * scale);
      for (const [canvas, enhanced] of [[left.current, blind && reverse], [right.current, !(blind && reverse)]] as const) {
        if (!canvas) continue; canvas.width = width; canvas.height = height;
        const pixels = renderView(enhanced, width, height, enhanced && depthEnabled && overlay && !blind);
        canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [photo, depth, settings, overlay, zoom, blind, reverse, comparison, baselineMode]);
  function download(blob: Blob, suffix: string) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${name.replace(/\.[^.]+$/, '') || 'vistas-as-seen'}-${suffix}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportImage(enhanced: boolean) {
    if (!photo) return;
    const canvas = document.createElement('canvas'); canvas.width = photo.width; canvas.height = photo.height;
    canvas.getContext('2d')!.putImageData(new ImageData(renderView(enhanced, photo.width, photo.height), photo.width, photo.height), 0, 0);
    const mode = enhanced ? comparison : baselineMode;
    canvas.toBlob(blob => blob && download(blob, mode === 'combined' ? 'rotation-depth.png' : mode === 'depth' ? 'enhanced.png' : `${mode}.png`));
  }
  function recipe() {
    const usesDepth = depthEnabled && depth;
    download(new Blob([JSON.stringify({ version: 3, comparison, baseline: baselineMode, effects: { rotation: rotationEnabled, depth: depthEnabled }, anchorSpace: rotationEnabled ? 'rotated-target-frame' : 'original-image', renderer: comparison === 'combined' ? 'rotation-then-depth-warp-v1' : comparison === 'rotation' ? 'fixed-center-rotation-v1' : comparison === 'crop' ? 'crop-v1' : 'bounded-inverse-depth-warp-v1', sourceHash: imageHash.current, originalSize: originalSize.current, workingSize: [photo?.width, photo?.height], model: usesDepth ? inferenceInfo.current?.model : null, runtime: '@huggingface/transformers@4.3.2', inference: usesDepth ? inferenceInfo.current : null, depthType: usesDepth ? 'relative-inverse-depth' : null, normalization: usesDepth ? '2nd–98th percentile; larger = nearer' : null, settings: activeSettings, camera: rotationEnabled && rotation ? { yawDegrees: rotation.yaw, pitchDegrees: rotation.pitch, translation: [0, 0, 0], sourceFootprint: rotation.corners, convention: 'rectilinear; centered principal point; diagonal 35mm equivalent; yaw then pitch; zero roll' } : null, preference: vote, depth: usesDepth ? { width: depth.width, height: depth.height, data: Array.from(depth.data) } : null }, null, 2)], { type: 'application/json' }), 'recipe.json');
  }
  const c = crop(activeSettings);
  function moveCrop(event: React.PointerEvent<HTMLDivElement>) {
    const drag = cropDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    setSettings(s => {
      const room = 1 - crop(s).size;
      if (room <= 0) return s;
      return fit({ ...s, panX: clamp((u - drag.offsetX) / room), panY: clamp((v - drag.offsetY) / room) });
    });
    setVote('');
  }
  function startCropDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    const insideCrop = u >= c.x && u <= c.x + c.size && v >= c.y && v <= c.y + c.size;
    const inside = rotationEnabled && rotation ? rotation.corners.every(([x, y], i, corners) => {
      const next = corners[(i + 1) % corners.length];
      return (next[0] - x) * (v - y) - (next[1] - y) * (u - x) >= 0;
    }) : insideCrop;
    cropDrag.current = { id: event.pointerId, offsetX: inside ? u - c.x : c.size / 2, offsetY: inside ? v - c.y : c.size / 2 };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    moveCrop(event);
  }
  function endCropDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (cropDrag.current?.id !== event.pointerId) return;
    cropDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, display: string) => <label className="slider"><span>{label}<b>{display}</b></span><input aria-label={label} type="range" min={min} max={max} step={step} value={settings[key]} onChange={e => change(key, Number(e.target.value))}/></label>;
  return <><header><a className="brand" href={import.meta.env.BASE_URL}>◩ Vistas As Seen</a><span className="badge">PERSPECTIVE LAB / POC 01</span><span className="privacy">● Photos stay on this device</span></header>
    <main><div className="intro"><div className="eyebrow">A DIFFERENT POINT OF VIEW</div><h1>Bring the distance closer.</h1><p>One photograph. Choose a direction. Compare crop, camera rotation, and depth enhancement.</p></div>
    <div className="workspace"><aside><div className="section-title"><span>01</span> Your photograph</div><label className="upload">{name || '＋ Choose a photograph'}<input aria-label="Choose a photograph" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ''; }}/></label><p className="hint">JPEG, PNG, WebP · HEIC if supported by your browser. Working resolution capped at 1600 px.</p>
    <fieldset disabled={!photo}><div className="section-title"><span>02</span> Target frame</div><div className="numbers"><label>Source · mm<input aria-label="Source focal length" type="number" min="8" max="200" value={settings.source} onChange={e => { const source = Math.max(8, Math.min(200, Number(e.target.value) || 24)); setSettings(s => fit({ ...s, source, target: Math.max(source, s.target) })); setVote(''); }}/></label><label>Target · mm<input aria-label="Target focal length" type="number" min={settings.source} max="300" value={settings.target} onChange={e => change('target', Math.max(settings.source, Math.min(300, Number(e.target.value) || 50)))}/></label></div>
    <div className="effect-toggles"><label><input type="checkbox" aria-label="Camera rotation" checked={rotationEnabled} onChange={e => setEffects(e.target.checked, depthEnabled)}/> Camera rotation</label><label><input type="checkbox" aria-label="Depth enhancement" checked={depthEnabled} onChange={e => setEffects(rotationEnabled, e.target.checked)}/> Depth enhancement</label></div>
    <p className="hint">{(1/c.size).toFixed(2)}× crop · {Math.round(c.size*c.size*100)}% crop-only area. Position the target directly on the original preview.</p>
    {rotationEnabled && <p className="hint rotation-note">Turn the camera from the same position. {depthEnabled ? 'Depth enhancement is applied after rotation.' : 'No depth estimation needed.'} Movement stops at the image boundary to preserve the {settings.target} mm field of view.{rotation && <><br/>Yaw {rotation.yaw.toFixed(1)}° · Pitch {rotation.pitch.toFixed(1)}°</>}</p>}
    {depthEnabled && <>
    <div className="section-title"><span>03</span> Depth enhancement</div><label className="model-picker">Depth model<select aria-label="Depth model" value={modelId} onChange={e => selectModel(e.target.value as DepthModelId)}>{depthModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><p className="hint model-note">{selectedModel.note}<br/><a href={`https://huggingface.co/${modelId}`} target="_blank" rel="noreferrer">{selectedModel.license}</a></p><button className="primary" onClick={estimate} disabled={busy || !!depth}>{busy ? 'Estimating depth…' : depth ? '✓ Depth estimated' : 'Estimate depth on this device'}</button>{busy && <button className="small" onClick={() => { ++generation.current; worker.current?.terminate(); worker.current = null; setBusy(false); setStatus('Depth estimation cancelled'); }}>Cancel estimation</button>}<p className="hint">First use downloads a depth model from Hugging Face. Inference uses your GPU when available, with automatic CPU fallback.</p>
    <fieldset disabled={!depth}>{slider('Background emphasis', 'strength', 0, .4, .01, `${Math.round(settings.strength*100)}%`)}{slider('Anchor horizontal', 'anchorX', 0, 1, .01, `${Math.round(settings.anchorX*100)}%`)}{slider('Anchor vertical', 'anchorY', 0, 1, .01, `${Math.round(settings.anchorY*100)}%`)}<p className="hint">Place the anchor on your distant subject {rotationEnabled ? 'within the rotated result' : 'in the original photo'}. Near regions stay fixed; distant regions expand around it. Inspect edges for stretching.</p></fieldset></>}</fieldset>
    </aside><section className="results">
    {photo && !blind && <article className="original-preview"><div className="image-label"><b>Original photo + target frame</b><span>{rotationEnabled ? 'OUTLINE: BASELINE WITHOUT DEPTH' : 'OUTLINED AREA IS THE CROP-ONLY RESULT'}</span></div><div className="original-frame" role="group" aria-label="Position crop" aria-describedby="crop-help" tabIndex={0}
      onPointerDown={startCropDrag} onPointerMove={moveCrop} onPointerUp={endCropDrag} onPointerCancel={endCropDrag} onLostPointerCapture={() => { cropDrag.current = null; }}
      onKeyDown={event => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const step = event.shiftKey ? .1 : .01;
        setSettings(s => fit({ ...s, panX: clamp(s.panX + direction[0] * step), panY: clamp(s.panY + direction[1] * step) })); setVote('');
      }}><canvas ref={original} role="img" aria-label="Original photo, uncropped and unenhanced"/><div hidden={baselineMode === 'rotation'} className={rotationEnabled ? 'crop-outline crop-baseline' : 'crop-outline'} role="img" aria-label="Crop-only area" style={{ left: `${c.x*100}%`, top: `${c.y*100}%`, width: `${c.size*100}%`, height: `${c.size*100}%` }}>{!rotationEnabled && <span>Crop only · {settings.target} mm</span>}</div>{rotationEnabled && rotation && <><svg className="rotation-outline" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Camera rotation source footprint"><path className="rotation-shade" fillRule="evenodd" d={`M0 0H100V100H0Z M${rotation.corners.map(([u, v]) => `${u * 100} ${v * 100}`).join('L')}Z`}/><polygon points={rotation.corners.map(([u, v]) => `${u * 100},${v * 100}`).join(' ')} vectorEffect="non-scaling-stroke"/><path className="aim-cross" d={`M${rotation.center[0]*100-1} ${rotation.center[1]*100}h2 M${rotation.center[0]*100} ${rotation.center[1]*100-1}v2`} vectorEffect="non-scaling-stroke"/></svg><span className="rotation-frame-label" style={{ left: `clamp(0px, ${rotation.corners[0][0]*100}%, calc(100% - 70px))`, top: `clamp(0px, ${rotation.corners[0][1]*100}%, calc(100% - 28px))` }}>{settings.target} mm</span></>}</div><p className="hint" id="crop-help">Drag the target frame, or click outside it to aim there. Arrow keys fine-tune; Shift moves faster. {rotationEnabled && 'The frame stays inside the photo at the selected focal length.'}</p></article>}
    <div className="toolbar"><span>THE COMPARISON</span><div><label><input type="checkbox" checked={zoom} onChange={e => setZoom(e.target.checked)}/> Pixel view</label><label><input type="checkbox" disabled={!depthEnabled || !depth || blind} checked={depthEnabled && overlay && !blind} onChange={e => setOverlay(e.target.checked)}/> Depth map</label></div></div>
    {!photo ? <div className="empty"><div className="landscape">◭</div><h2>Start with a view worth remembering.</h2><p>Choose a landscape with a clear foreground and distant mountains or buildings.</p><div className="empty-tags"><span>01 / CROP</span><span>02 / CAMERA ROTATION</span></div></div> : <div className={`pair ${zoom ? 'pixel' : ''}`}>{[left, right].map((ref, i) => <article key={i}><div className="image-label"><b>{blind ? (i === 0 ? 'A' : 'B') : i === 0 ? viewNames[baselineMode] : overlay && depthEnabled ? 'Relative depth' : viewNames[comparison]}</b><span>{blind ? 'BLIND COMPARISON' : i === 0 ? 'BASELINE · NO DEPTH' : !depthEnabled ? 'FIXED POSITION · NO DEPTH' : depth ? comparison === 'combined' ? 'CAMERA ROTATION + PERCEPTUAL WARP' : 'PERCEPTUAL WARP' : 'DEPTH NOT ESTIMATED'}</span></div><div className="viewport" onScroll={e => { const other = e.currentTarget.parentElement?.parentElement?.children[1-i]?.querySelector('.viewport'); if (other) { other.scrollLeft = e.currentTarget.scrollLeft; other.scrollTop = e.currentTarget.scrollTop; } }}><canvas ref={ref}/></div></article>)}</div>}
    <div className="status" role="status"><span className={busy ? 'pulse' : ''}>●</span> {status}</div>{error && <div className="error" role="alert">{error}</div>}
    <div className="evaluation"><div><h3>Which version feels closer to the scene?</h3><p>Look at distant prominence, foreground shapes, and straight edges.</p></div><button disabled={!comparisonReady} onClick={() => { if (!blind) { setReverse(Math.random() < .5); setVote(''); } else if (vote) { const chosen = vote.split(': ')[1]; setVote(chosen === 'no preference' ? 'tie: no preference' : `${chosen === comparison ? 'right' : 'left'}: ${chosen}`); } setBlind(!blind); }}>{blind ? 'Reveal labels' : 'Compare without labels'}</button></div>
    {comparisonReady && <div className="votes">{['left', 'tie', 'right'].map(choice => <button className={vote.startsWith(choice) ? 'selected' : ''} key={choice} onClick={() => setVote(`${choice}: ${choice === 'tie' ? 'no preference' : ((choice === 'left') === (blind && reverse) ? comparison : baselineMode)}`)}>{choice === 'tie' ? 'No preference' : `Prefer ${blind ? choice === 'left' ? 'A' : 'B' : viewNames[choice === 'left' ? baselineMode : comparison].toLowerCase()}`}</button>)}{vote && <span>Preference recorded in recipe.</span>}</div>}
    <div className="exports"><button disabled={!photo} onClick={() => exportImage(false)}>↓ {baselineMode === 'rotation' ? 'Rotation' : 'Crop'} PNG</button><button disabled={!comparisonReady} onClick={() => exportImage(true)}>↓ {comparison === 'combined' ? 'Rotation + depth' : comparison === 'depth' ? 'Enhanced' : 'Result'} PNG</button><button disabled={!photo} onClick={recipe}>↓ Edit recipe</button></div><p className="footnote">{!depthEnabled ? 'Fixed-position camera framing · Assumes a rectilinear photo and centered lens; focal length controls calibration. No depth, camera translation, or generated fill.' : comparison === 'combined' ? 'Fixed-position camera rotation followed by artistic depth enhancement. The depth map follows the same rotation. No camera translation or generated fill; inspect straight edges for stretching.' : 'Experimental perceptual enhancement · Relative depth, no metric distance or physical camera reconstruction. No generated fill.'} Exports use the working resolution and omit source EXIF.</p>
    </section></div><footer className="sponsorship">This project is sponsored by <strong>Crossborder Art &amp; Media LLC.</strong> <a href={`${import.meta.env.BASE_URL}LICENSE.txt`}>Apache-2.0 license</a> <a href={`${import.meta.env.BASE_URL}NOTICE.txt`}>Notices</a></footer></main></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
