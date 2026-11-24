import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = 'http://127.0.0.1:5281/vrm-poser/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const failed = [];
page.on('requestfailed', (r) => failed.push(r.url().split('/vrm-poser/').pop() || r.url()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().split('/vrm-poser/').pop());
});

try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + '?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(2500);

  const state = await page.evaluate(() => ({
    avatarKind: window.__poser.avatar?.kind ?? 'none',
    libOpen: document.getElementById('modellib')?.classList.contains('open'),
    cards: document.querySelectorAll('.model-card').length,
    emptyHint: document.querySelector('#modellib-grid .hint')?.textContent ?? '',
    status: document.getElementById('status')?.textContent ?? '',
  }));
  console.log('页面状态:', JSON.stringify(state));
  console.log('加载失败的请求:', failed.length ? JSON.stringify(failed.slice(0, 8)) : '无');

  // 姿势库能否打开（验证 /poses/manifest.json 前缀）
  await page.evaluate(() => document.getElementById('modellib')?.classList.remove('open'));
  await page.evaluate(() => document.getElementById('btn-gallery')?.click());
  await sleep(1800);
  const gallery = await page.evaluate(() => ({
    open: document.getElementById('gallery')?.classList.contains('open'),
    cards: document.querySelectorAll('#gallery-grid .pose-card, #gallery-grid .card, #gallery-grid button').length,
    count: document.getElementById('gallery-count')?.textContent ?? '',
  }));
  console.log('姿势库:', JSON.stringify(gallery));
  console.log('累计失败请求:', failed.length ? JSON.stringify(failed.slice(0, 8)) : '无');
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

