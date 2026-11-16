import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[modellib]')) console.log('  ', t);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(1500);

  const libState = await page.evaluate(() => ({
    open: document.getElementById('modellib')?.classList.contains('open'),
    tabs: [...document.querySelectorAll('#modellib-tabs .tab')].map((t) => t.textContent),
    cards: [...document.querySelectorAll('.model-card')].map((c) => ({
      name: c.querySelector('strong')?.textContent,
      sub: c.querySelector('.model-meta span')?.textContent,
    })),
    count: document.getElementById('modellib-count')?.textContent,
  }));
  console.log('角色库:', JSON.stringify(libState, null, 2));
  await page.screenshot({ path: 'shots/modellib-1.png' });

  // 点第一个卡片
  await page.evaluate(() => document.querySelector('.model-card')?.click());
  await page.waitForFunction(() => {
    const s = document.getElementById('status')?.textContent ?? '';
    return s.includes('已加载') || s.includes('失败');
  }, { timeout: 120000, polling: 400 });
  await sleep(2500);
  const afterLoad = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent,
    kind: window.__poser.avatar?.kind,
    libOpen: document.getElementById('modellib')?.classList.contains('open'),
  }));
  console.log('加载后:', JSON.stringify(afterLoad));
  await page.screenshot({ path: 'shots/modellib-2-loaded.png' });

  // 重新打开角色库，检查缩略图
  await page.evaluate(() => window.__modelLibrary.open());
  await sleep(1200);
  const thumbs = await page.evaluate(() => ({
    ready: document.querySelectorAll('.model-thumb.ready').length,
    total: document.querySelectorAll('.model-card').length,
  }));
  console.log('缩略图:', JSON.stringify(thumbs));
  await page.screenshot({ path: 'shots/modellib-3-thumbs.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
