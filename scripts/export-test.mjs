import fs from 'node:fs';
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
  await page.setViewport({ width: 1000, height: 900 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1800);

  // 直接调导出（不点按钮，避免下载弹窗），拿回尺寸并把 dataURL 存下来
  const out = await page.evaluate(async () => {
    const origClick = HTMLAnchorElement.prototype.click;
    let captured = null;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        captured = this.href;
        return;
      }
      return origClick.call(this);
    };
    const res = await window.__poser.exportPng({ longEdge: 2160, transparent: true });
    HTMLAnchorElement.prototype.click = origClick;
    return { res, len: captured?.length ?? 0, head: captured?.slice(0, 32) ?? '' };
  });
  console.log('导出结果:', JSON.stringify(out));

  // 把图存下来检查尺寸与透明通道
  if (out.len > 1000) {
    const dataUrl = await page.evaluate(() => window.__lastExport ?? null);
    // 重新导一次拿 dataURL（上面已被局部作用域吃掉，这里走 canvas 尺寸验证）
    const dims = await page.evaluate(async () => {
      const res = await window.__poser.exportPng({ longEdge: 1024, transparent: false, background: '#203040' });
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 100;
      return { res, canvasW: document.querySelector('canvas').width, canvasH: document.querySelector('canvas').height };
    });
    console.log('二次导出:', JSON.stringify(dims));
    void dataUrl;
  }

  // 校验：导出后渲染尺寸已还原
  const restore = await page.evaluate(() => ({
    canvasW: document.querySelector('canvas').width,
    canvasH: document.querySelector('canvas').height,
    pixelRatio: window.__poser.rendererPixelRatio ?? null,
  }));
  console.log('还原后:', JSON.stringify(restore));

  // UI 冒烟：打开面板
  await page.evaluate(() => document.getElementById('btn-export').click());
  await sleep(400);
  const ui = await page.evaluate(() => ({
    open: document.getElementById('exportpng')?.classList.contains('open'),
    sizes: [...document.querySelectorAll('#exportpng-form select option')].map((o) => o.textContent),
    transparent: document.querySelector('#exportpng-form [name="transparent"]')?.checked,
  }));
  console.log('面板:', JSON.stringify(ui));
  await page.screenshot({ path: path.join(SHOTS, 'export-1.png') });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
