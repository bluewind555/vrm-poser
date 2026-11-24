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

const probe = () =>
  page.evaluate(() => {
    const panel = document.getElementById('panel');
    const btn = document.getElementById('btn-panel-toggle');
    const r = panel.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      panel: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      toggle: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height), display: getComputedStyle(btn).display },
      collapsed: document.body.classList.contains('panel-collapsed'),
      btnText: btn.textContent,
      // 有没有横向溢出
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

try {
  const sizes = [
    [1280, 900, 'desktop'],
    [768, 900, 'tablet'],
    [390, 844, 'phone'],
    [360, 640, 'small'],
  ];

  for (const [w, h, name] of sizes) {
    await page.setViewport({ width: w, height: h, isMobile: w < 500, hasTouch: w < 500 });
    await page.goto(`${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
    await sleep(1200);
    console.log(name, JSON.stringify(await probe()));
    await page.screenshot({ path: path.join(SHOTS, `resp-${name}.png`) });
  }

  // 手机上收起面板
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(300);
  const before = await probe();
  await page.evaluate(() => document.getElementById('btn-panel-toggle').click());
  await sleep(600);
  const after = await probe();
  console.log('收起前:', JSON.stringify(before.panel), '按钮', before.btnText);
  console.log('收起后:', JSON.stringify(after.panel), '按钮', after.btnText, 'collapsed=', after.collapsed);
  await page.screenshot({ path: path.join(SHOTS, 'resp-phone-collapsed.png') });

  // 展开回来
  await page.evaluate(() => document.getElementById('btn-panel-toggle').click());
  await sleep(500);
  console.log('再展开:', JSON.stringify((await probe()).panel));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
