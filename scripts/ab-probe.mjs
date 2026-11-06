import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9237';
const MODEL = process.env.MODEL || '/models/xun/%E6%B5%94.pmx';
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 800 });
await page.goto(`http://127.0.0.1:5280/?cb=${Date.now()}&model=${MODEL}`, {
  waitUntil: 'domcontentloaded',
  timeout: 90000,
});
await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', {
  timeout: 30000,
}).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

// 低机位看脚
await page.evaluate(() => {
  const p = window.__poser;
  p.controls.target.set(0, 0.18, 0);
  p.camera.position.set(0.7, 0.36, 1.15);
  p.controls.update();
});
await new Promise((r) => setTimeout(r, 600));

const setContact = async (v) => {
  await page.evaluate((val) => {
    window.__tuning.state.contact = val;
    window.__tuning.apply();
  }, v);
  await new Promise((r) => setTimeout(r, 500));
};

await setContact(0);
await page.screenshot({ path: 'shots/cs2-off.png' });
await setContact(0.95);
await page.screenshot({ path: 'shots/cs2-on.png' });

// 球面高光 A/B
await page.evaluate(() => {
  const p = window.__poser;
  p.controls.target.set(0, 1.15, 0);
  p.camera.position.set(0.5, 1.35, 1.9);
  p.controls.update();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  window.__tuning.state.sph = 0;
  window.__tuning.apply();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'shots/sph2-off.png' });
await page.evaluate(() => {
  window.__tuning.state.sph = 1.2;
  window.__tuning.apply();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: 'shots/sph2-on.png' });

console.log('done');
await page.close();
await browser.disconnect();
