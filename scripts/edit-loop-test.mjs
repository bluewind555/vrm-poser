import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', {
    timeout: 60000,
  }).catch(() => {});
  await sleep(1500);

  // 1) 打开画廊，点一个生成的姿势
  await page.evaluate(() => document.getElementById('btn-gallery').click());
  await sleep(800);
  const clicked = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.pose-card')].find((c) =>
      (c.querySelector('strong')?.textContent ?? '').includes('扭身'),
    );
    card?.click();
    return card?.querySelector('strong')?.textContent;
  });
  console.log('选中姿势:', clicked);
  await sleep(900);

  // 2) 改一根骨骼（leftUpperArm 的 X）
  await page.evaluate(() => {
    const sel = document.getElementById('bone');
    sel.value = 'leftUpperArm';
    sel.dispatchEvent(new Event('change'));
    const x = document.getElementById('rot-x');
    x.value = '35';
    x.dispatchEvent(new Event('input'));
  });
  await sleep(600);
  await page.screenshot({ path: 'shots/edit-1-modified.png' });

  // 3) 覆盖保存
  await page.evaluate(() => document.getElementById('btn-overwrite').click());
  await sleep(800);
  const afterSave = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent,
    overrides: Object.keys(JSON.parse(localStorage.getItem('vrm-poser:pose-overrides:v1') || '{}')),
  }));
  console.log(JSON.stringify(afterSave, null, 2));

  // 4) 重新打开画廊，检查「已改」标记
  await page.evaluate(() => document.getElementById('btn-gallery').click());
  await sleep(1500);
  const galleryState = await page.evaluate(() => ({
    edited: [...document.querySelectorAll('.pose-edited')].length,
    cards: document.querySelectorAll('.pose-card').length,
  }));
  console.log('画廊:', JSON.stringify(galleryState));
  await page.screenshot({ path: 'shots/edit-2-gallery.png' });

  // 5) 关掉画廊，测试镜像
  await page.evaluate(() => document.getElementById('gallery-close').click());
  await sleep(400);
  await page.evaluate(() => document.getElementById('btn-mirror').click());
  await sleep(900);
  console.log('镜像后状态:', await page.evaluate(() => document.getElementById('status')?.textContent));
  await page.screenshot({ path: 'shots/edit-3-mirrored.png' });

  // 6) 撤销
  await page.evaluate(() => document.getElementById('btn-revert').click());
  await sleep(700);
  const afterRevert = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent,
    overrides: Object.keys(JSON.parse(localStorage.getItem('vrm-poser:pose-overrides:v1') || '{}')),
  }));
  console.log('撤销后:', JSON.stringify(afterRevert));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
