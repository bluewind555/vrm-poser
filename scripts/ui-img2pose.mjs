import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const BASE = process.env.BASE || 'http://localhost:5273/';
const IMG = process.env.IMG || 'public/models/posedata/P001_front.png';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[img2pose]') || t.includes('[pmx] 使用')) console.log('  ', t);
});

try {
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  const input = await page.$('#pose-image');
  await input.uploadFile(IMG);

  // 等状态栏变成"已从图片生成姿势"或报错
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status')?.textContent || '';
      return s.includes('图片生成') || s.includes('没找到人') || s.includes('失败');
    },
    { timeout: 120000, polling: 300 },
  );
  await new Promise((r) => setTimeout(r, 1200));

  const info = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent,
    chips: [...document.querySelectorAll('#confidence .chip')].map((c) => c.textContent),
    marked: [...document.querySelectorAll('#bone option')].filter((o) => o.textContent.includes('⚠')).map((o) => o.value),
  }));
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: 'shots/ui-img2pose.png' });
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.7, 0.1);
    p.camera.position.set(2.2, 1.0, 2.2);
    p.controls.update();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'shots/ui-img2pose-34.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
