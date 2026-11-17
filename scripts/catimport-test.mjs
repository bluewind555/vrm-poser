import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');

const SAMPLE = [
  '刻晴\t原神\thttps://www.aplaybox.com/details/model/AAAAAAAAAAAA',
  '胡桃 | 原神 | https://www.aplaybox.com/details/model/BBBBBBBBBBBB',
  '今汐, 鸣潮, https://www.aplaybox.com/details/model/CCCCCCCCCCCC',
  '- 散兵 https://www.aplaybox.com/details/model/DDDDDDDDDDDD',
  'https://www.aplaybox.com/details/model/EEEEEEEEEEEE',
  '这一行没有链接应该报错',
  '刻晴\t原神\thttps://www.aplaybox.com/details/model/AAAAAAAAAAAA',
].join('\n');

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(1000);
  await page.evaluate(() => localStorage.removeItem('vrm-poser:catalog-extra:v1'));

  // 打开目录 → 导入条目
  await page.evaluate(() => document.getElementById('btn-catalog').click());
  await sleep(800);
  await page.evaluate(() => document.getElementById('catimport-open').click());
  await sleep(500);

  // 粘贴样例 + 预览
  await page.evaluate((sample) => {
    const ta = document.getElementById('catimport-text');
    ta.value = sample;
    ta.dispatchEvent(new Event('input'));
    document.getElementById('catimport-parse').click();
  }, SAMPLE);
  await sleep(400);

  const preview = await page.evaluate(() => ({
    stat: document.getElementById('catimport-stat')?.textContent,
    rows: [...document.querySelectorAll('.catimport-row')].map((r) => ({
      name: r.querySelector('strong')?.textContent,
      meta: r.querySelector('span')?.textContent,
    })),
  }));
  console.log('预览:', JSON.stringify(preview, null, 2));
  await page.screenshot({ path: path.join(SHOTS, 'catimport-1.png') });

  // 导入
  await page.evaluate(() => document.getElementById('catimport-apply').click());
  await sleep(900);
  const after = await page.evaluate(() => ({
    status: document.getElementById('status')?.textContent,
    stored: JSON.parse(localStorage.getItem('vrm-poser:catalog-extra:v1') || '[]').length,
    count: document.getElementById('catalog-count')?.textContent,
    firstCards: [...document.querySelectorAll('#catalog-grid .model-card strong')].slice(0, 4).map((n) => n.textContent),
  }));
  console.log('导入后:', JSON.stringify(after, null, 2));
  await page.screenshot({ path: path.join(SHOTS, 'catimport-2-after.png') });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
