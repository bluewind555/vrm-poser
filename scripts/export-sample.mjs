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
  await page.setViewport({ width: 900, height: 900 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1800);

  const dataUrl = await page.evaluate(async () => {
    let captured = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { captured = this.href; return; }
      return orig.call(this);
    };
    await window.__poser.exportPng({ longEdge: 1600, transparent: true });
    HTMLAnchorElement.prototype.click = orig;
    return captured;
  });

  if (!dataUrl) throw new Error('没有捕获到导出数据');
  const base64 = dataUrl.split(',')[1];
  const out = path.join(SHOTS, 'export-transparent.png');
  fs.writeFileSync(out, Buffer.from(base64, 'base64'));
  console.log('已写入', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');

  // 检查四角是否透明（可用 puppeteer 读 PNG？简单点：用浏览器解码再采样）
  const corners = await page.evaluate((url) => {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
        res({ w: img.width, h: img.height, tl: px(2, 2), tr: px(img.width - 3, 2), bl: px(2, img.height - 3), center: px(img.width >> 1, img.height >> 1) });
      };
      img.onerror = () => res({ error: 'decode fail' });
      img.src = url;
    });
  }, dataUrl);
  console.log('像素采样:', JSON.stringify(corners));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
