import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://localhost:5273/';
const MODEL = 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[tune]') || t.includes('[pmx] hips')) console.log('  ', t);
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(`${BASE}?pose=/poses/sit.json&${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(1500);

  const state = await page.evaluate(() => {
    const a = window.__poser.avatar;
    const mats = a.mesh.material;
    return {
      tuning: window.__tuning?.state ?? null,
      firstMat: {
        type: mats[0].type,
        name: mats[0].name,
        outline: mats[0].userData.outlineParameters ?? null,
      },
      // 手动再 apply 一次，看会不会变
      beforeManual: mats[0].userData.outlineParameters?.thickness ?? null,
    };
  });
  console.log('STATE', JSON.stringify(state, null, 2));

  const after = await page.evaluate(() => {
    const t = window.__tuning;
    t.state.outline = 0.006;
    t.apply();
    const mats = window.__poser.avatar.mesh.material;
    return {
      tuningOutline: t.state.outline,
      matThickness: mats[0].userData.outlineParameters?.thickness ?? null,
    };
  });
  console.log('AFTER manual apply', JSON.stringify(after));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
