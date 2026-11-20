import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[pmx] 表情')) console.log('  ', t);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1000, height: 900 });
  await page.goto(`${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1500);

  const info = await page.evaluate(() => {
    const a = window.__poser.avatar;
    return {
      count: a?.morphList?.length ?? 0,
      names: (a?.morphList ?? []).map((m) => m.name),
      influences: a?.mesh?.morphTargetInfluences?.length ?? 0,
    };
  });
  console.log('表情数:', info.count, '| target 数:', info.influences);
  console.log('表情列表:', info.names.join(' / '));

  // 试一个表情：找"まばたき"（眨眼）或先用第一个
  const pick = info.names.find((n) => n.includes('まばたき')) ?? info.names[0];
  const res = await page.evaluate((name) => {
    const a = window.__poser.avatar;
    a.applyMorphs({ [name]: 1 });
    return { name, nonZero: [...a.mesh.morphTargetInfluences].filter((v) => v > 0.01).length };
  }, pick);
  console.log('应用表情:', JSON.stringify(res));

  const zero = await page.evaluate(() => {
    const a = window.__poser.avatar;
    a.applyMorphs({});
    return [...a.mesh.morphTargetInfluences].filter((v) => v > 0.01).length;
  });
  console.log('清空后非零目标:', zero);
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
