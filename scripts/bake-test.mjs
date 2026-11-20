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
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[bake]') || t.includes('缩略图失败')) console.log('  console:', t);
});

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });

  // 清空缩略图缓存，模拟"全都没烤过"
  await page.evaluate(() => indexedDB.deleteDatabase('vrm-poser-thumbs'));
  await sleep(600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(800);

  const before = await page.evaluate(() => ({
    ready: document.querySelectorAll('.model-thumb.ready').length,
    total: document.querySelectorAll('.model-card').length,
  }));
  console.log('烤前:', JSON.stringify(before));

  // 等待后台烘焙（每个模型 5~20 秒，2 个模型给足 90 秒）
  for (let i = 0; i < 18; i++) {
    await sleep(5000);
    const st = await page.evaluate(() => ({
      status: document.getElementById('modellib-bake')?.textContent || '',
      ready: document.querySelectorAll('.model-thumb.ready').length,
      total: document.querySelectorAll('.model-card').length,
    }));
    console.log(`  ${(i + 1) * 5}s: ${JSON.stringify(st)}`);
    if (st.ready >= st.total) break;
  }

  const after = await page.evaluate(() => ({
    ready: document.querySelectorAll('.model-thumb.ready').length,
    total: document.querySelectorAll('.model-card').length,
  }));
  console.log('烤后:', JSON.stringify(after));
  await page.screenshot({ path: path.join(SHOTS, 'bake-1.png') });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
