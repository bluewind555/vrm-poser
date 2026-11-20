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

const state = () =>
  page.evaluate(() => ({
    locked: document.body.classList.contains('pose-locked'),
    hint: (() => {
      const h = document.getElementById('pose-lock-hint');
      return h && !h.hidden ? h.textContent : '';
    })(),
    motion: document.getElementById('motion-name')?.textContent,
    // 姿势面板是否真的点不动
    sliderPointer: (() => {
      const s = document.getElementById('rot-x');
      const cs = getComputedStyle(s.closest('[data-pose]'));
      return cs.pointerEvents;
    })(),
  }));

try {
  await page.setViewport({ width: 1100, height: 950 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1200);
  console.log('初始:', JSON.stringify(await state()));

  // 开始动作 → 应锁定
  await page.evaluate(() => document.getElementById('btn-motion-vmd1').click());
  await sleep(1500);
  console.log('动作中:', JSON.stringify(await state()));
  await page.screenshot({ path: path.join(SHOTS, 'pose-lock-1.png') });

  // 从预设应用姿势 → 应先停动作、再解锁
  const applied = await page.evaluate(async () => {
    const before = document.getElementById('motion-name')?.textContent;
    const res = await fetch('/poses/neutral.json');
    const pose = await res.json();
    window.__poser.applyPose(pose);
    await new Promise((r) => setTimeout(r, 700));
    return { before, after: document.getElementById('motion-name')?.textContent };
  });
  console.log('应用姿势:', JSON.stringify(applied), '→', JSON.stringify(await state()));
  await page.screenshot({ path: path.join(SHOTS, 'pose-lock-2.png') });

  // 再开动作，点停止 → 解锁
  await page.evaluate(() => document.getElementById('btn-motion-sway').click());
  await sleep(800);
  const during = await state();
  await page.evaluate(() => document.getElementById('btn-motion-stop').click());
  await sleep(600);
  console.log('停止后:', JSON.stringify(await state()), '（之前:', during.locked + '）');
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
