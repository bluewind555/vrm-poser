import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');

const TEX = ['脸.png', '体1.png', '体2.png', '皮肤1.png', '皮肤2.png', '发.png', '发+.png'];

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(800);
  await page.evaluate(() => indexedDB.deleteDatabase('vrm-poser-models'));
  await page.evaluate(() => localStorage.removeItem('vrm-poser:catalog-hidden:v1'));
  await sleep(500);

  // 在页面里构造带 __relPath 的 File（模拟"载入文件夹"）
  const built = await page.evaluate(async (texNames) => {
    const wrap = async (url, rel) => {
      const r = await fetch(url);
      const buf = await r.arrayBuffer();
      const f = new File([buf], rel.split('/').pop());
      f.__relPath = rel;
      return f;
    };
    const files = [await wrap('/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx', '维琳娜/维琳娜6.pmx')];
    for (const n of texNames) {
      try {
        files.push(await wrap(`/models/weilina/Texture/${encodeURIComponent(n)}`, `维琳娜/Texture/${n}`));
      } catch {
        /* 有的贴图可能不存在，忽略 */
      }
    }
    window.__testFiles = files;
    return files.length;
  }, TEX);
  console.log('构造文件数:', built);

  await page.evaluate(() => window.__loadFromFiles(window.__testFiles));
  await page.waitForFunction(() => {
    const s = document.getElementById('status')?.textContent ?? '';
    return s.includes('收藏') || s.includes('已加载') || s.includes('失败');
  }, { timeout: 120000, polling: 400 });
  await sleep(2500);
  console.log('载入状态:', await page.evaluate(() => document.getElementById('status')?.textContent));

  // 角色库
  await page.evaluate(() => window.__modelLibrary.open());
  await sleep(1500);
  const lib = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.model-card')].map((c) => ({
      name: c.querySelector('strong')?.textContent,
      badge: c.querySelector('.local-badge')?.textContent ?? '',
    })),
  }));
  console.log('角色库:', JSON.stringify(lib));
  await page.screenshot({ path: path.join(SHOTS, 'local-1.png') });

  // 目录删除按钮
  await page.evaluate(() => document.getElementById('catalog-close')?.click());
  await page.evaluate(() => document.getElementById('btn-catalog').click());
  await sleep(1000);
  const before = await page.evaluate(() => document.querySelectorAll('.catalog-card').length);
  await page.evaluate(() => document.querySelector('.catalog-card .cat-del')?.click());
  await sleep(600);
  const after = await page.evaluate(() => ({
    cards: document.querySelectorAll('.catalog-card').length,
    count: document.getElementById('catalog-count')?.textContent,
    hiddenBtn: document.getElementById('catalog-hidden')?.textContent,
  }));
  console.log('删除:', before, '→', JSON.stringify(after));
  await page.screenshot({ path: path.join(SHOTS, 'local-2-catalog.png') });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

