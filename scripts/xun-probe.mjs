import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9235';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const MODEL = process.env.MODEL || 'model=/models/xun/%E6%B5%94.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${BASE}?${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(2000);

  const info = await page.evaluate(() => {
    const a = window.__poser.avatar;
    if (!a || a.kind !== 'pmx') return { kind: a?.kind };
    const mats = a.mesh.material;
    const sample = mats.slice(0, 6).map((m) => ({
      name: m.name,
      type: m.type,
      color: `#${m.color?.getHexString?.()}`,
      map: !!m.map,
      transparent: m.transparent,
      opacity: m.opacity,
      alphaTest: m.alphaTest,
      side: m.side,
      toneMapped: m.toneMapped,
      outline: m.userData?.outlineParameters ?? null,
    }));
    return { kind: a.kind, count: mats.length, sample, textures: window.__pmxTextures };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'shots/xun-materials.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
