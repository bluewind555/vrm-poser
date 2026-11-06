import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const data = JSON.parse(fs.readFileSync('.tmp-posedata/landmarks.json', 'utf8'));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
await page.goto(`http://localhost:5273/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

const info = await page.evaluate((world) => {
  const a = window.__poser.avatar;
  const before = {
    rootY: a.root.position.y,
    lowest: a.getLowestWorldY?.(),
    clearance: a.groundClearance,
  };
  const pose = window.__poser.applyLandmarks(world);
  const after = {
    rootY: a.root.position.y,
    lowest: a.getLowestWorldY?.(),
    bones: Object.keys(pose?.bones ?? {}).length,
    hips: a.root.position.toArray().map((v) => +v.toFixed(3)),
  };
  // 再手动接地一次，看会不会变
  const again = window.__poser.avatar.groundClearance;
  return { before, after, clearance: again, status: document.getElementById('status')?.textContent };
}, data.front.world);

console.log(JSON.stringify(info, null, 2));
await page.close();
await browser.disconnect();
