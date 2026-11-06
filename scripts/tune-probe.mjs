import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.POSER_URL;
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const OUT = path.resolve('shots');

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();

try {
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[console.error]', m.text());
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 30000 }).catch(() => {});
  await sleep(1200);

  // 近景，方便看明暗差异
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 1.15, 0);
    p.camera.position.set(0.4, 1.25, 1.6);
    p.controls.update();
  });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, 'tune-a-default.png') });

  // 立体度拉低 → 应该出现明显明暗对比
  const readBack = await page.evaluate(() => {
    const el = document.getElementById('tune-shading');
    el.value = '0.6';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      slider: el.value,
      label: document.getElementById('tune-shading-v').textContent,
      floor: window.__poser?.avatar?.getShadingFloor?.(),
    };
  });
  console.log('after shading=0.6:', JSON.stringify(readBack));
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'tune-b-dark.png') });

  // 描边加到很粗 → 应该能明显看到轮廓
  const outline = await page.evaluate(() => {
    const el = document.getElementById('tune-outline');
    el.value = '0.01';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { slider: el.value, label: document.getElementById('tune-outline-v').textContent };
  });
  console.log('after outline=0.01:', JSON.stringify(outline));
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'tune-c-outline.png') });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
