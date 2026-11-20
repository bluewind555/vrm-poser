import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const measure = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const times = [];
        let last = performance.now();
        let n = 0;
        const tick = () => {
          const now = performance.now();
          times.push(now - last);
          last = now;
          if (++n < 180) requestAnimationFrame(tick);
          else {
            times.sort((a, b) => a - b);
            const avg = times.reduce((s, v) => s + v, 0) / times.length;
            res({
              avgMs: +avg.toFixed(2),
              p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2),
              fps: +(1000 / avg).toFixed(1),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );

try {
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(`${BASE}?cb=${Date.now()}&model=/models/xun/%E6%B5%94.pmx&pose=/poses/neutral.json`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(2500);

  const box = await page.evaluate(() => {
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.move(box.x + box.w * 0.7, box.y + box.h * 0.5);
  await sleep(600);
  console.log('凝视开启:', JSON.stringify(await measure()));

  await page.evaluate(() => window.__poser.setGazeEnabled(false));
  await sleep(600);
  console.log('凝视关闭:', JSON.stringify(await measure()));

  await page.evaluate(() => document.getElementById('btn-motion-breath').click());
  await sleep(600);
  console.log('动作开启:', JSON.stringify(await measure()));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
