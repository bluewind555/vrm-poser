import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', {
    timeout: 60000,
  }).catch(() => {});
  await sleep(1500);

  const views = ['front', 'side', 'back', 'top', 'bottom', 'closeup'];
  for (const v of views) {
    const ok = await page.evaluate((name) => window.__poser.setViewPreset(name), v);
    await sleep(450);
    const cam = await page.evaluate(() => {
      const c = window.__poser.camera;
      return {
        pos: c.position.toArray().map((n) => +n.toFixed(2)),
        target: window.__poser.controls.target.toArray().map((n) => +n.toFixed(2)),
      };
    });
    console.log(v.padEnd(8), ok ? 'ok' : 'FAIL', JSON.stringify(cam));
    await page.screenshot({ path: path.join(SHOTS, `view-${v}.png`) });
  }

  // 自动环绕
  await page.evaluate(() => document.getElementById('btn-autorotate').click());
  await sleep(1200);
  const rot = await page.evaluate(() => ({
    autoRotate: window.__poser.controls.autoRotate,
    label: document.getElementById('btn-autorotate')?.textContent,
  }));
  console.log('自动环绕:', JSON.stringify(rot));
  await page.screenshot({ path: path.join(SHOTS, 'view-autorotate.png') });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

