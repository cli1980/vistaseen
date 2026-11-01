import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import exifr from 'exifr';
import { clamp, crop, renderPixels, type Depth, type Settings } from './geometry';
import './style.css';
import { depthModels, getDepthModel, type DepthModelId } from './models';

const defaults: Settings = { source: 24, target: 50, panX: .5, panY: .5, anchorX: .5, anchorY: .5, strength: .22 };
function App() {
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
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!photo || !original.current) return;
    original.current.width = photo.width;
    original.current.height = photo.height;
    original.current.getContext('2d')!.putImageData(photo, 0, 0);
  }, [photo, blind]);
  const change = (key: keyof Settings, value: number) => { setSettings(s => ({ ...s, [key]: value })); setVote(''); };
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
        const pixels = renderPixels(photo, enhanced ? depth : null, settings, width, height, enhanced && overlay && !blind);
        canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
      }
    });
    return () => cancelAnimationFrame(handle);
  }, [photo, depth, settings, overlay, zoom, blind, reverse]);
  function download(blob: Blob, suffix: string) {
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `${name.replace(/\.[^.]+$/, '') || 'vistas-as-seen'}-${suffix}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportImage(enhanced: boolean) {
    if (!photo) return;
    const canvas = document.createElement('canvas'); canvas.width = photo.width; canvas.height = photo.height;
    canvas.getContext('2d')!.putImageData(new ImageData(renderPixels(photo, enhanced ? depth : null, settings, photo.width, photo.height), photo.width, photo.height), 0, 0);
    canvas.toBlob(blob => blob && download(blob, enhanced ? 'enhanced.png' : 'crop.png'));
  }
  function recipe() {
    download(new Blob([JSON.stringify({ version: 1, renderer: 'bounded-inverse-depth-warp-v1', sourceHash: imageHash.current, originalSize: originalSize.current, workingSize: [photo?.width, photo?.height], model: depth ? inferenceInfo.current?.model : null, runtime: '@huggingface/transformers@4.3.2', inference: inferenceInfo.current, depthType: 'relative-inverse-depth', normalization: '2nd–98th percentile; larger = nearer', settings, preference: vote, depth: depth ? { width: depth.width, height: depth.height, data: Array.from(depth.data) } : null }, null, 2)], { type: 'application/json' }), 'recipe.json');
  }
  const c = crop(settings);
  function moveCrop(event: React.PointerEvent<HTMLDivElement>) {
    const drag = cropDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    setSettings(s => {
      const room = 1 - crop(s).size;
      if (room <= 0) return s;
      return { ...s, panX: clamp((u - drag.offsetX) / room), panY: clamp((v - drag.offsetY) / room) };
    });
    setVote('');
  }
  function startCropDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width, v = (event.clientY - rect.top) / rect.height;
    const inside = u >= c.x && u <= c.x + c.size && v >= c.y && v <= c.y + c.size;
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
  return <><header><a className="brand" href="/">◩ Vistas As Seen</a><span className="badge">PERSPECTIVE LAB / POC 01</span><span className="privacy">● Photos stay on this device</span></header>
    <main><div className="intro"><div className="eyebrow">A DIFFERENT POINT OF VIEW</div><h1>Bring the distance closer.</h1><p>One photograph. The same crop. Does depth make the difference?</p></div>
    <div className="workspace"><aside><div className="section-title"><span>01</span> Your photograph</div><label className="upload">{name || '＋ Choose a photograph'}<input aria-label="Choose a photograph" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file); e.target.value = ''; }}/></label><p className="hint">JPEG, PNG, WebP · HEIC if supported by your browser. Working resolution capped at 1600 px.</p>
    <fieldset disabled={!photo}><div className="section-title"><span>02</span> Shared crop</div><div className="numbers"><label>Source · mm<input aria-label="Source focal length" type="number" min="8" max="200" value={settings.source} onChange={e => { const source = Math.max(8, Math.min(200, Number(e.target.value) || 24)); setSettings(s => ({ ...s, source, target: Math.max(source, s.target) })); setVote(''); }}/></label><label>Target · mm<input aria-label="Target focal length" type="number" min={settings.source} max="300" value={settings.target} onChange={e => change('target', Math.max(settings.source, Math.min(300, Number(e.target.value) || 50)))}/></label></div>
    <p className="hint">{(1/c.size).toFixed(2)}× crop · {Math.round(c.size*c.size*100)}% of image area retained. Position the crop directly on the original preview.</p>
    <div className="section-title"><span>03</span> Depth enhancement</div><label className="model-picker">Depth model<select aria-label="Depth model" value={modelId} onChange={e => selectModel(e.target.value as DepthModelId)}>{depthModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><p className="hint model-note">{selectedModel.note}<br/><a href={`https://huggingface.co/${modelId}`} target="_blank" rel="noreferrer">{selectedModel.license}</a></p><button className="primary" onClick={estimate} disabled={busy || !!depth}>{busy ? 'Estimating depth…' : depth ? '✓ Depth estimated' : 'Estimate depth on this device'}</button>{busy && <button className="small" onClick={() => { ++generation.current; worker.current?.terminate(); worker.current = null; setBusy(false); setStatus('Depth estimation cancelled'); }}>Cancel estimation</button>}<p className="hint">First use downloads a depth model from Hugging Face. Inference uses your GPU when available, with automatic CPU fallback.</p>
    <fieldset disabled={!depth}>{slider('Background emphasis', 'strength', 0, .4, .01, `${Math.round(settings.strength*100)}%`)}{slider('Anchor horizontal', 'anchorX', 0, 1, .01, `${Math.round(settings.anchorX*100)}%`)}{slider('Anchor vertical', 'anchorY', 0, 1, .01, `${Math.round(settings.anchorY*100)}%`)}<p className="hint">Place the anchor on your distant subject. Near regions stay fixed; distant regions expand around it. Inspect edges for stretching.</p></fieldset></fieldset>
    </aside><section className="results">
    {photo && !blind && <article className="original-preview"><div className="image-label"><b>Original photo + crop</b><span>OUTLINED AREA IS THE CROP-ONLY RESULT</span></div><div className="original-frame" role="group" aria-label="Position crop" aria-describedby="crop-help" tabIndex={0}
      onPointerDown={startCropDrag} onPointerMove={moveCrop} onPointerUp={endCropDrag} onPointerCancel={endCropDrag} onLostPointerCapture={() => { cropDrag.current = null; }}
      onKeyDown={event => {
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const step = event.shiftKey ? .1 : .01;
        setSettings(s => ({ ...s, panX: clamp(s.panX + direction[0] * step), panY: clamp(s.panY + direction[1] * step) })); setVote('');
      }}><canvas ref={original} role="img" aria-label="Original photo, uncropped and unenhanced"/><div className="crop-outline" role="img" aria-label="Crop-only area" style={{ left: `${c.x*100}%`, top: `${c.y*100}%`, width: `${c.size*100}%`, height: `${c.size*100}%` }}><span>Crop only · {settings.target} mm</span></div></div><p className="hint" id="crop-help">Drag the crop box, or click outside it to center it there. Arrow keys fine-tune the position; Shift moves faster.</p></article>}
    <div className="toolbar"><span>THE COMPARISON</span><div><label><input type="checkbox" checked={zoom} onChange={e => setZoom(e.target.checked)}/> Pixel view</label><label><input type="checkbox" disabled={!depth || blind} checked={overlay && !blind} onChange={e => setOverlay(e.target.checked)}/> Depth map</label></div></div>
    {!photo ? <div className="empty"><div className="landscape">◭</div><h2>Start with a view worth remembering.</h2><p>Choose a landscape with a clear foreground and distant mountains or buildings.</p><div className="empty-tags"><span>01 / CROP</span><span>02 / CROP + DEPTH</span></div></div> : <div className={`pair ${zoom ? 'pixel' : ''}`}>{[left, right].map((ref, i) => <article key={i}><div className="image-label"><b>{blind ? (i === 0 ? 'A' : 'B') : i === 0 ? 'Crop only' : overlay ? 'Relative depth' : 'Crop + perspective'}</b><span>{blind ? 'BLIND COMPARISON' : i === 0 ? 'BASELINE' : depth ? 'PERCEPTUAL WARP' : 'DEPTH NOT ESTIMATED'}</span></div><div className="viewport" onScroll={e => { const other = e.currentTarget.parentElement?.parentElement?.children[1-i]?.querySelector('.viewport'); if (other) { other.scrollLeft = e.currentTarget.scrollLeft; other.scrollTop = e.currentTarget.scrollTop; } }}><canvas ref={ref}/></div></article>)}</div>}
    <div className="status" role="status"><span className={busy ? 'pulse' : ''}>●</span> {status}</div>{error && <div className="error" role="alert">{error}</div>}
    <div className="evaluation"><div><h3>Which version feels closer to the scene?</h3><p>Look at distant prominence, foreground shapes, and straight edges.</p></div><button disabled={!depth} onClick={() => { if (!blind) { setReverse(Math.random() < .5); setVote(''); } else if (vote) { setVote(vote.includes('enhanced') ? 'right: enhanced' : vote.includes('crop') ? 'left: crop' : 'tie: no preference'); } setBlind(!blind); }}>{blind ? 'Reveal labels' : 'Compare without labels'}</button></div>
    {depth && <div className="votes">{['left', 'tie', 'right'].map(choice => <button className={vote.startsWith(choice) ? 'selected' : ''} key={choice} onClick={() => setVote(`${choice}: ${choice === 'tie' ? 'no preference' : ((choice === 'left') === (blind && reverse) ? 'enhanced' : 'crop')}`)}>{choice === 'tie' ? 'No preference' : `Prefer ${blind ? choice === 'left' ? 'A' : 'B' : choice === 'left' ? 'crop' : 'enhanced'}`}</button>)}{vote && <span>Preference recorded in recipe.</span>}</div>}
    <div className="exports"><button disabled={!photo} onClick={() => exportImage(false)}>↓ Crop PNG</button><button disabled={!depth} onClick={() => exportImage(true)}>↓ Enhanced PNG</button><button disabled={!photo} onClick={recipe}>↓ Edit recipe</button></div><p className="footnote">Experimental perceptual enhancement · Relative depth, no metric distance or physical camera reconstruction. No generated fill. Exports use the working resolution and omit source EXIF.</p>
    </section></div><footer className="sponsorship">This project is sponsored by <strong>Crossborder Art &amp; Media LLC.</strong> <a href="/LICENSE.txt">Apache-2.0 license</a> <a href="/NOTICE.txt">Notices</a></footer></main></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
