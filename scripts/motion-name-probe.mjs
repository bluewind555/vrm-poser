import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[vmd]') || t.includes('error')) console.log('  console:', t);
});

try {
  await page.setViewport({ width: 1000, height: 900 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1200);

  const dump = () =>
    page.evaluate(() => ({
      status: document.getElementById('status')?.textContent,
      motion: document.getElementById('motion-name')?.textContent,
      locked: document.body.classList.contains('pose-locked'),
      // 直接看内部状态
      hasMotion: !!window.__poser.currentMotionName,
    }));

  await page.evaluate(() => document.getElementById('btn-motion-vmd1').click());
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    console.log(i, JSON.stringify(await dump()));
  }

  // 应用姿势应停止动作
  const pose = await (await fetch('http://127.0.0.1:5280/poses/neutral.json')).json();
  const r = await page.evaluate((p) => {
    window.__poser.applyPose(p);
    return document.getElementById('motion-name')?.textContent;
  }, pose);
  await sleep(700);
  console.log('applyPose 后:', r, JSON.stringify(await dump()));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
