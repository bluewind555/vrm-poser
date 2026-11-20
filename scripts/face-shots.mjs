import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.setViewport({ width: 900, height: 900 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1500);

  // 隐藏面板，用官方特写取景
  await page.evaluate(() => {
    document.getElementById('panel').style.display = 'none';
    const hint = document.getElementById('hint');
    if (hint) hint.style.display = 'none';
    window.__poser.setViewPreset('closeup');
    // 再往脸推近，方便看口型/眼型变化
    const p = window.__poser;
    p.camera.position.lerp(p.controls.target, 0.45);
    p.camera.near = 0.01;
    p.camera.updateProjectionMatrix();
    p.controls.update();
  });
  await sleep(900);

  const setMorph = async (map) => {
    await page.evaluate((m) => window.__poser.avatar.applyMorphs(m), map);
    await sleep(300);
  };
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });

  await setMorph({});
  await shot('face-0-neutral.png');
  await setMorph({ にっこり: 1 });
  await shot('face-1-smile.png');
  await setMorph({ まばたき: 1 });
  await shot('face-2-blink.png');
  await setMorph({ 怒り: 1 });
  await shot('face-3-angry.png');
  await setMorph({ びっくり: 1 });
  await shot('face-4-surprise.png');
  await setMorph({ にやり: 1 });
  await shot('face-5-smirk.png');
  console.log('done');
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

