import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const URL = process.env.POSE_TEST_URL || 'http://localhost:5273/pose-test.html';
const OUT = process.env.OUT || '.tmp-posedata/landmarks.json';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[pose-test]')) console.log('  ', t);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__done === true', { timeout: 180000, polling: 500 });
  const res = await page.evaluate(() => ({ data: window.__landmarks, error: window.__error }));
  if (res.error) {
    console.log('PAGE ERROR:', res.error);
  } else {
    fs.writeFileSync(OUT, JSON.stringify(res.data, null, 2));
    const idx = { 鼻: 0, 左肩: 11, 右肩: 12, 左肘: 13, 右肘: 14, 左腕: 15, 右腕: 16, 左髋: 23, 右髋: 24, 左膝: 25, 右膝: 26, 左踝: 27, 右踝: 28 };
    for (const [v, d] of Object.entries(res.data)) {
      if (!d.found) {
        console.log(`${v.padEnd(6)} 未检测到人`);
        continue;
      }
      const pick = (i) => d.world[i].slice(0, 3).map((n) => n.toFixed(2)).join(',');
      console.log(`${v.padEnd(6)} ${d.size.join('x')}  ${d.ms}ms  鼻(${pick(0)})  左肩(${pick(11)})  右肩(${pick(12)})  左膝(${pick(25)})  左踝(${pick(27)})`);
    }
    console.log('saved:', OUT);
  }
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
