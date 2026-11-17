import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(1200);

  // 打开模型目录
  await page.evaluate(() => document.getElementById('btn-catalog').click());
  await sleep(1200);

  const state = await page.evaluate(() => ({
    open: document.getElementById('catalog')?.classList.contains('open'),
    count: document.getElementById('catalog-count')?.textContent,
    tabs: [...document.querySelectorAll('#catalog-tabs .tab')].map((t) => t.textContent),
    cards: [...document.querySelectorAll('#catalog-grid .model-card')].map((c) => ({
      name: c.querySelector('strong')?.textContent,
      game: c.querySelector('.model-meta span')?.textContent,
      badge: c.querySelector('.cat-badge')?.textContent,
    })),
  }));
  console.log(JSON.stringify(state, null, 2));
  await page.screenshot({ path: path.join(SHOTS, 'catalog-1.png') });

  // 搜索过滤
  await page.evaluate(() => {
    const s = document.getElementById('catalog-search');
    s.value = '原神';
    s.dispatchEvent(new Event('input'));
  });
  await sleep(400);
  const filtered = await page.evaluate(() => ({
    count: document.getElementById('catalog-count')?.textContent,
    names: [...document.querySelectorAll('#catalog-grid .model-card strong')].map((n) => n.textContent),
  }));
  console.log('搜索「原神」:', JSON.stringify(filtered));
  await page.screenshot({ path: path.join(SHOTS, 'catalog-2-filter.png') });

  // 点一个"待补链接"的卡片，应提示
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#catalog-grid .model-card')].find((c) =>
      c.querySelector('.cat-badge')?.textContent === '待补链接',
    );
    card?.click();
  });
  await sleep(500);
  console.log('点击待补链接:', await page.evaluate(() => document.getElementById('status')?.textContent));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
