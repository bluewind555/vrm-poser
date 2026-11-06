import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const URL = process.env.POSE_TEST_URL || 'http://localhost:5273/pose-test.html';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[pose-test]')) console.log('  ', t);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.setViewport({ width: 1000, height: 800 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__done === true', { timeout: 180000, polling: 500 });
  const res = await page.evaluate(() => ({ r: window.__variantResults, e: window.__error }));
  console.log('RESULT', JSON.stringify(res, null, 2));
  await page.screenshot({ path: 'shots/variant-test.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
