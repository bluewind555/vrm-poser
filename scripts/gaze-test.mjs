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

const headState = () =>
  page.evaluate(() => {
    const g = window.__poser.gaze;
    if (!g) return null;
    return { yawDeg: +(g.yaw * 180 / Math.PI).toFixed(1), pitchDeg: +(g.pitch * 180 / Math.PI).toFixed(1) };
  });

try {
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', {
    timeout: 60000,
  }).catch(() => {});
  await sleep(1500);

  // 特写视角，方便看头部
  await page.evaluate(() => window.__poser.setViewPreset('closeup'));
  await sleep(600);

  const canvasBox = await page.evaluate(() => {
    const r = window.__poser.camera && document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const cx = canvasBox.x + canvasBox.w / 2;
  const cy = canvasBox.y + canvasBox.h * 0.45;

  console.log('初始（无指针）:', JSON.stringify(await headState()));

  await page.mouse.move(cx, cy);
  await sleep(900);
  console.log('指针居中:', JSON.stringify(await headState()));
  await page.screenshot({ path: path.join(SHOTS, 'gaze-center.png') });

  // 指针移到画面左侧 → 角色应朝它的右侧（屏幕左）看
  await page.mouse.move(canvasBox.x + canvasBox.w * 0.34, cy);
  await sleep(1200);
  console.log('指针在左:', JSON.stringify(await headState()));
  await page.screenshot({ path: path.join(SHOTS, 'gaze-left.png') });

  // 指针移到画面右侧
  await page.mouse.move(canvasBox.x + canvasBox.w * 0.92, cy);
  await sleep(1200);
  console.log('指针在右:', JSON.stringify(await headState()));
  await page.screenshot({ path: path.join(SHOTS, 'gaze-right.png') });

  // 指针移到底部 → 抬头/低头
  await page.mouse.move(cx, canvasBox.y + canvasBox.h * 0.95);
  await sleep(1200);
  console.log('指针在下:', JSON.stringify(await headState()));
  await page.screenshot({ path: path.join(SHOTS, 'gaze-down.png') });

  // 关掉开关应回正
  await page.evaluate(() => document.getElementById('btn-gaze').click());
  await sleep(1200);
  console.log('关闭后:', JSON.stringify(await headState()), await page.evaluate(() => document.getElementById('btn-gaze').textContent));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}


