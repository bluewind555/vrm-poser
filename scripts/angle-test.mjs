import puppeteer from 'puppeteer-core';

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

  const limits = await page.evaluate(() => ({
    maxPolar: window.__poser.controls.maxPolarAngle,
    minPolar: window.__poser.controls.minPolarAngle,
    minDist: window.__poser.controls.minDistance,
  }));
  console.log('控制限制:', JSON.stringify(limits));

  // 四个角度各来一张：正面 / 侧面 / 背面 / 正下方
  const shots = [
    ['front', [0.9, 1.35, 3.4], [0, 1.0, 0]],
    ['side', [3.6, 1.2, 0.05], [0, 1.0, 0]],
    ['back', [-0.4, 1.3, -3.4], [0, 1.0, 0]],
    ['below', [0, -1.15, 1.9], [0, 0.55, 0]],
  ];
  for (const [name, pos, target] of shots) {
    await page.evaluate(
      ({ pos, target }) => {
        const p = window.__poser;
        p.controls.target.set(target[0], target[1], target[2]);
        p.camera.position.set(pos[0], pos[1], pos[2]);
        p.controls.update();
      },
      { pos, target },
    );
    await sleep(500);
    await page.screenshot({ path: `shots/angle-${name}.png` });
    const state = await page.evaluate(() => ({
      camY: +window.__poser.camera.position.y.toFixed(2),
      groundVisible: window.__poser.ground?.visible ?? null,
    }));
    console.log(name, JSON.stringify(state));
  }
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

