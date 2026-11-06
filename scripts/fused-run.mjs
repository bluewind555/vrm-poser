import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const DATA = JSON.parse(fs.readFileSync('.tmp-posedata/landmarks5.json', 'utf8'));

const views = ['front', 'side', 'high']
  .filter((v) => DATA[v]?.found)
  .map((v) => ({ name: v, world: DATA[v].world }));
console.log('参与融合的视图:', views.map((v) => v.name).join(' + '));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(`http://localhost:5273/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const info = await page.evaluate((vs) => {
    const pose = window.__poser.applyFusedLandmarks(vs);
    return {
      bones: pose ? Object.keys(pose.bones).length : 0,
      status: document.getElementById('status')?.textContent,
    };
  }, views);
  console.log(JSON.stringify(info));

  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: 'shots/fused-front.png' });
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.7, 0.1);
    p.camera.position.set(2.2, 1.0, 2.2);
    p.controls.update();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'shots/fused-34.png' });
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.7, 0.1);
    p.camera.position.set(3.2, 0.9, 0.05);
    p.controls.update();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'shots/fused-side.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
