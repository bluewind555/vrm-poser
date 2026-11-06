import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const OUT = process.env.OUT || '.tmp-posedata/batch-landmarks.json';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[batch]')) console.log('  ', t);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(`http://localhost:5273/pose-batch.html?cb=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('window.__done === true', { timeout: 600000, polling: 800 });
  const res = await page.evaluate(() => ({ data: window.__batch, error: window.__error }));
  if (res.error) {
    console.log('PAGE ERROR:', res.error);
  } else {
    fs.writeFileSync(OUT, JSON.stringify(res.data, null, 2));
    const rows = Object.entries(res.data);
    const bad = rows.filter(([, v]) => !v.fused);
    console.log(`姿势 ${rows.length} 组，检出 ${rows.length - bad.length}，失败 ${bad.length}`);
    if (bad.length) console.log('未检出:', bad.map(([k, v]) => `${k} ${v.name}`).join(' / '));
    console.log('saved:', OUT);
  }
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
