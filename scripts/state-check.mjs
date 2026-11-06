import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const data = JSON.parse(fs.readFileSync('.tmp-posedata/landmarks.json', 'utf8'));
const VIEW = process.env.VIEW || 'front';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900 });
await page.goto(`http://localhost:5273/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

const info = await page.evaluate((world) => {
  const T = window.__THREE;
  const a = window.__poser.avatar;
  window.__poser.applyLandmarks(world);
  a.root.updateMatrixWorld(true);
  const foot = a.getBoneWorldPosition('leftFoot', new T.Vector3());
  const hips = a.getBoneWorldPosition('hips', new T.Vector3());
  const shadow = window.__poser.contactShadow;
  return {
    rootY: +a.root.position.y.toFixed(4),
    lowest: +a.getLowestWorldY().toFixed(4),
    footY: +foot.y.toFixed(3),
    hipsY: +hips.y.toFixed(3),
    shadowY: +shadow.position.y.toFixed(3),
    shadowXZ: [+shadow.position.x.toFixed(2), +shadow.position.z.toFixed(2)],
    shadowScale: +shadow.scale.x.toFixed(2),
  };
}, data[VIEW].world);

console.log(JSON.stringify(info, null, 2));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: `shots/ground-${VIEW}.png` });
await page.close();
await browser.disconnect();
