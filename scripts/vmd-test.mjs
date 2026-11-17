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

// 读真实 MMD 骨骼（VMD 直接驱动它们）
const realBone = (name) =>
  page.evaluate((n) => {
    const b = window.__poser.avatar?.bones?.get(n);
    if (!b) return null;
    return [+b.quaternion.x.toFixed(4), +b.quaternion.y.toFixed(4), +b.quaternion.z.toFixed(4), +b.quaternion.w.toFixed(4)];
  }, name);

try {
  await page.setViewport({ width: 1100, height: 950 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1500);

  await page.evaluate(() => document.getElementById('btn-motion-vmd1').click());
  await page.waitForFunction(
    () => (document.getElementById('status')?.textContent ?? '').includes('已载入动作'),
    { timeout: 30000, polling: 300 },
  );
  console.log('① 内置待机A:', await page.evaluate(() => document.getElementById('status')?.textContent));
  console.log('   动作名:', await page.evaluate(() => document.getElementById('motion-name')?.textContent));

  const b1 = await realBone('上半身2');
  await sleep(900);
  const b2 = await realBone('上半身2');
  console.log('② 上半身2 四元数:', JSON.stringify(b1), '→', JSON.stringify(b2));
  console.log('   是否在动:', JSON.stringify(b1) !== JSON.stringify(b2) ? '✓' : '✗');

  await page.screenshot({ path: path.join(SHOTS, 'vmd-1.png') });

  // 待机B
  await page.evaluate(() => document.getElementById('btn-motion-vmd2').click());
  await sleep(1500);
  console.log('③ 待机B:', await page.evaluate(() => document.getElementById('status')?.textContent));
  await page.screenshot({ path: path.join(SHOTS, 'vmd-2.png') });

  // 停止 → externalPose 应关闭，姿势恢复
  await page.evaluate(() => document.getElementById('btn-motion-stop').click());
  await sleep(800);
  const afterStop = await realBone('上半身2');
  console.log('④ 停止后 上半身2:', JSON.stringify(afterStop));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
