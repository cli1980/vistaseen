import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Capture actual app output, with no retouching or synthetic depth.
// Select the depth comparison; leave its model, crop, and enhancement at defaults.
await mkdir('docs/showcase', { recursive: true });
await mkdir('.tmp', { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
try {
  await page.goto('http://127.0.0.1:5173');
  await page.getByLabel('Choose a photograph').setInputFiles('samples/IMG20240105123302.jpg');
  await page.getByRole('status').filter({ hasText: 'Photo ready' }).waitFor();
  await page.getByRole('checkbox', { name: 'Camera rotation', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Depth enhancement', exact: true }).check();
  await page.getByRole('button', { name: 'Estimate depth on this device' }).click();
  const timer = setInterval(async () => console.log(await page.getByRole('status').innerText().catch(() => '')), 15000);
  try { await page.getByRole('status').filter({ hasText: 'Depth ready' }).waitFor({ timeout: 900000 }); } finally { clearInterval(timer); }
  console.log(await page.getByRole('status').innerText());
  await page.waitForTimeout(500);
  const recipeEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '↓ Edit recipe' }).click();
  await (await recipeEvent).saveAs('.tmp/showcase-recipe.json');
  const recipe = JSON.parse(await readFile('.tmp/showcase-recipe.json', 'utf8'));
  const { depth, ...metadata } = recipe;
  await writeFile('docs/showcase/settings.json', JSON.stringify({ ...metadata, sourceFile: 'samples/IMG20240105123302.jpg', note: 'Depth comparison selected; other settings remain at import defaults, including automatic GPU-first/CPU-fallback selection.', depthDimensions: [depth.width, depth.height] }, null, 2) + '\n');
  // Presentation-only styling for README captures. Photo pixels, crop, and warp
  // remain the canvases rendered by the app.
  await page.addStyleTag({ content: `
    .pair {width:1200px;gap:20px;padding:24px;background:#1b211c;grid-template-columns:1fr 1fr;border-radius:12px}
    .pair .viewport {max-height:none}
    .image-label b {font-size:19px}.image-label span {font-size:11px}
    .original-preview {width:1200px;padding:24px;background:#1b211c;border-radius:12px}
    .original-preview .hint {display:none}
    .crop-outline span {font-size:14px;padding:8px 12px}
  ` });
  await page.locator('.pair').screenshot({ path: 'docs/showcase/comparison-defaults-50mm.png' });
  await page.locator('.original-preview').screenshot({ path: 'docs/showcase/original-overlay-defaults-50mm.png' });
  console.log('Saved comparison, original overlay, and settings to docs/showcase/.');
} catch (error) {
  console.error(await page.getByRole('status').innerText().catch(() => ''));
  console.error(await page.locator('.error').allTextContents());
  throw error;
} finally { await browser.close(); }
