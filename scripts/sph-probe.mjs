import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9236';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const MODEL = process.env.MODEL || '/models/xun/%E6%B5%94.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 800, height: 600 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /error|ERROR|THREE/i.test(t)) errors.push(`${m.type()}: ${t.slice(0, 300)}`);
  });

  await page.goto(`${BASE}?cb=${Date.now()}&model=${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(2500);

  const info = await page.evaluate(() => {
    const a = window.__poser.avatar;
    const mats = a?.mesh?.material ?? [];
    const withSph = mats.filter((m) => m.userData?.sph);
    return {
      kind: a?.kind,
      count: mats.length,
      withSph: withSph.length,
      sample: mats.slice(0, 5).map((m) => ({ name: m.name, type: m.type, sph: !!m.userData?.sph })),
      textures: window.__pmxTextures,
      shaderErrors: window.__poser?.renderer?.info?.programs?.length ?? null,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('ERRORS:', errors.slice(0, 8).join('\n') || '(none)');
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}


