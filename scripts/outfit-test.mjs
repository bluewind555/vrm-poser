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
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(1200);

  const cards = await page.evaluate(() => ({
    count: document.getElementById('modellib-count')?.textContent,
    cards: [...document.querySelectorAll('.model-card')].map((c) => ({
      name: c.querySelector('strong')?.textContent,
      sub: c.querySelector('.model-meta span')?.textContent,
      pills: [...c.querySelectorAll('.outfit-pill')].map((p) => p.textContent),
    })),
  }));
  console.log('分组结果:', JSON.stringify(cards, null, 2));
  await page.screenshot({ path: path.join(SHOTS, 'outfits-1.png') });

  // 点第二套服装
  const picked = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.model-card')].find((c) => c.querySelectorAll('.outfit-pill').length > 1);
    const pills = card ? [...card.querySelectorAll('.outfit-pill')] : [];
    if (pills[1]) {
      const label = pills[1].textContent;
      pills[1].click();
      return label;
    }
    return null;
  });
  console.log('点击服装:', picked);
  await page.waitForFunction(
    () => (document.getElementById('status')?.textContent ?? '').includes('已加载'),
    { timeout: 120000, polling: 400 },
  );
  await sleep(1500);
  console.log('状态:', await page.evaluate(() => document.getElementById('status')?.textContent));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
