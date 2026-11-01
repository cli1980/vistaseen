import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: process.env.FORCE_CPU ? ['--disable-gpu'] : [] });
const page = await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
page.on('console', msg=>{if(msg.type()==='error') console.log('browser:',msg.text().slice(0,500));});
try {
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading',{name:'Bring the distance closer.'}).waitFor();
  await page.screenshot({path:'.tmp/empty.png',fullPage:true});
  const png = await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=640;c.height=420;const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,0,420);g.addColorStop(0,'#74a7cf');g.addColorStop(.6,'#e5e7d1');g.addColorStop(.61,'#687d47');g.addColorStop(1,'#283f27');x.fillStyle=g;x.fillRect(0,0,640,420);
    x.fillStyle='#637b8b';x.beginPath();x.moveTo(0,270);x.lineTo(170,90);x.lineTo(300,250);x.lineTo(420,130);x.lineTo(640,270);x.fill();
    x.fillStyle='#c7c8c0';x.fillRect(110,230,60,170);x.fillStyle='#1b3320';x.beginPath();x.arc(520,270,60,0,Math.PI*2);x.fill();return c.toDataURL().split(',')[1];
  });
  await page.getByLabel('Choose a photograph').setInputFiles({name:'synthetic-landscape.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.getByRole('status').filter({hasText:'Photo ready'}).waitFor();
  const modelPicker=page.getByRole('combobox',{name:'Depth model',exact:true});
  assert.equal(await modelPicker.locator('option').count(),3);
  assert.equal(await page.getByLabel('Horizontal framing',{exact:true}).count(),0);
  const preview=page.getByRole('group',{name:'Position crop',exact:true});
  const bounds=await preview.boundingBox();
  const cropBox=page.getByRole('img',{name:'Crop-only area',exact:true});
  await preview.click({position:{x:bounds.width*.95,y:bounds.height*.95}});
  assert.ok(Math.abs(await cropBox.evaluate(el=>parseFloat(el.style.left))-52)<.01);
  assert.ok(Math.abs(await cropBox.evaluate(el=>parseFloat(el.style.top))-52)<.01);
  await page.mouse.move(bounds.x+bounds.width*.75,bounds.y+bounds.height*.75);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.55,bounds.y+bounds.height*.55,{steps:5});await page.mouse.up();
  const dragged=await cropBox.evaluate(el=>parseFloat(el.style.left));assert.ok(dragged>30&&dragged<34);
  await preview.press('ArrowLeft');assert.ok(await cropBox.evaluate(el=>parseFloat(el.style.left))<dragged);
  // Full-frame crop has no movable range and must never produce invalid positions.
  await page.getByLabel('Target focal length').fill('24');await preview.click({position:{x:10,y:10}});
  assert.equal(await cropBox.evaluate(el=>el.style.left),'0%');
  await page.getByLabel('Target focal length').fill('50');await page.waitForTimeout(250);
  const canvases=page.locator('.pair canvas');
  const before=await canvases.evaluateAll(cs=>cs.map(c=>c.toDataURL()));assert.equal(before.length,2); assert.equal(before[0],before[1]); await page.getByRole('img',{name:'Crop-only area',exact:true}).waitFor();
  await page.getByRole('button',{name:'Estimate depth on this device'}).click();
  const timer=setInterval(async()=>console.log(await page.getByRole('status').innerText().catch(()=>'')),15000);
  try {await page.getByRole('status').filter({hasText:'Depth ready'}).waitFor({timeout:240000});} finally{clearInterval(timer);}
  const depthStatus=await page.getByRole('status').innerText();console.log(depthStatus);
  assert.match(depthStatus,/GPU|CPU fallback/);
  if(process.env.FORCE_CPU) assert.match(depthStatus,/CPU fallback/);
  await page.waitForTimeout(500);
  const after=await canvases.evaluateAll(cs=>cs.map(c=>c.toDataURL()));assert.notEqual(after[0],after[1]);
  await page.getByLabel('Background emphasis').fill('0');await page.waitForTimeout(250);
  const zero=await canvases.evaluateAll(cs=>cs.map(c=>c.toDataURL()));assert.equal(zero[0],zero[1]);
  await page.getByLabel('Background emphasis').fill('0.3');
  await page.getByLabel('Depth map',{exact:true}).check();await page.waitForTimeout(250);await page.getByLabel('Depth map',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Compare without labels'}).click();await page.getByRole('button',{name:'Prefer A',exact:true}).click();
  await page.getByText('Preference recorded in recipe.').waitFor();await page.getByRole('button',{name:'Reveal labels'}).click();
  await page.getByText('Preference recorded in recipe.').waitFor();
  const recipeEvent=page.waitForEvent('download');await page.getByRole('button',{name:'↓ Edit recipe'}).click();const recipeDownload=await recipeEvent;await recipeDownload.saveAs('.tmp/recipe.json');
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'↓ Enhanced PNG'}).click();const download=await downloadEvent;await download.saveAs('.tmp/export.png');
  await page.screenshot({path:'.tmp/comparison.png',fullPage:true});
  for (const size of ['base','large']) {
    await modelPicker.selectOption(`onnx-community/depth-anything-v2-${size}`);
    await page.getByRole('status').filter({hasText:'selected'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'↓ Enhanced PNG'}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Estimate depth on this device'}).isEnabled(),true);
    await page.getByText('CC-BY-NC-4.0 · Noncommercial use only',{exact:true}).waitFor();
    const cleared=await canvases.evaluateAll(cs=>cs.map(c=>c.toDataURL()));assert.equal(cleared[0],cleared[1]);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.tmp/mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS: real browser depth inference, crop identity, enhancement, blind vote, PNG export, responsive layout.');
} catch(e) {console.error(await page.getByRole('status').innerText().catch(()=>''));console.error(await page.locator('.error').allTextContents());throw e;} finally {await browser.close();}
