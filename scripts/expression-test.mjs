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
  await page.setViewport({ width: 1100, height: 1000 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1500);
  await page.evaluate(() => window.__poser.setViewPreset('closeup'));
  await sleep(800);

  const info = await page.evaluate(() => ({
    count: document.getElementById('expression-count')?.textContent,
    rows: document.querySelectorAll('.expr-row').length,
    presets: [...document.querySelectorAll('#expression-presets .btn')].map((b) => ({
      label: b.textContent,
      enabled: !b.disabled,
      morph: b.dataset.morph,
    })),
  }));
  console.log('面板:', JSON.stringify(info, null, 2));

  await page.screenshot({ path: path.join(SHOTS, 'expr-0.png') });

  // 点「微笑」
  const r = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#expression-presets .btn')].find((b) => b.textContent === '微笑');
    if (!btn || btn.disabled) return 'unavailable';
    btn.click();
    const inf = window.__poser.avatar.mesh.morphTargetInfluences;
    return { name: btn.dataset.morph, nonZero: [...inf].filter((v) => v > 0.01).length, status: document.getElementById('status')?.textContent };
  });
  console.log('微笑:', JSON.stringify(r));
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, 'expr-1-smile.png') });

  // 眨眼
  await page.evaluate(() => {
    [...document.querySelectorAll('#expression-presets .btn')].find((b) => b.textContent === '眨眼')?.click();
  });
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, 'expr-2-blink.png') });
  console.log('眨眼看 target:', await page.evaluate(() => [...window.__poser.avatar.mesh.morphTargetInfluences].filter((v) => v > 0.01).length));

  // 拖一个滑条
  const slider = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.expr-row')].find((r) => r.dataset.name.includes('怒り'));
    if (!row) return null;
    const input = row.querySelector('input');
    input.value = '0.8';
    input.dispatchEvent(new Event('input'));
    return { name: row.dataset.name, nonZero: [...window.__poser.avatar.mesh.morphTargetInfluences].filter((v) => v > 0.01).length };
  });
  console.log('滑条:', JSON.stringify(slider));
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, 'expr-3-angry.png') });

  // 清空
  await page.evaluate(() => document.getElementById('btn-expr-reset').click());
  await sleep(400);
  console.log('清空后:', await page.evaluate(() => [...window.__poser.avatar.mesh.morphTargetInfluences].filter((v) => v > 0.01).length));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
