import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const MODEL = 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snap = () =>
  page.evaluate(() => {
    const a = window.__poser.avatar;
    const T = window.__THREE;
    const pos = (n) => {
      const b = a.getBoneWorldPosition ? a.getBoneWorldPosition(n, new T.Vector3()) : null;
      return b ? [b.x, b.y, b.z].map((v) => +v.toFixed(3)) : null;
    };
    return {
      rootY: +a.root.position.y.toFixed(4),
      knee: pos('leftLowerLeg'),
      hips: pos('hips'),
      version: document.getElementById('app-version')?.textContent ?? '',
      status: document.getElementById('status')?.textContent,
    };
  });

try {
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  await page.goto(`${BASE}?${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 30000 }).catch(() => {});
  await sleep(1200);
  console.log('0 初始:', JSON.stringify(await snap()));

  // 连续点 5 次接地校正：高度必须稳定
  for (let i = 1; i <= 5; i++) {
    await page.evaluate(() => document.getElementById('btn-ground').click());
    await sleep(250);
    const s = await snap();
    console.log(`  接地 ${i}: rootY=${s.rootY}`);
  }

  // 点坐姿
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#presets .chip')];
    chips.find((c) => c.textContent.includes('坐姿'))?.click();
  });
  await sleep(1200);
  console.log('1 坐姿:', JSON.stringify(await snap()));

  // 再点一次接地，看是否稳定
  await page.evaluate(() => document.getElementById('btn-ground').click());
  await sleep(400);
  console.log('2 坐姿+接地:', JSON.stringify(await snap()));

  await page.screenshot({ path: 'shots/verify-sit.png' });
  // 侧面
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.6, 0.15);
    p.camera.position.set(2.6, 0.85, 2.6);
    p.controls.update();
  });
  await sleep(500);
  await page.screenshot({ path: 'shots/verify-sit-34.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
