import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9237';
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const out = [];

for (const q of ['contact=1', 'contact=0']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 650 });
  await page.goto(`http://127.0.0.1:5280/?cb=${Date.now()}&${q}&model=/models/xun/%E6%B5%94.pmx`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await new Promise((r) => setTimeout(r, 2000));
  const s = await page.evaluate(() => {
    const c = window.__poser.contactShadow;
    return {
      stateContact: window.__tuning?.state?.contact,
      visible: c?.visible,
      opacity: c?.material?.opacity,
      hasMap: !!c?.material?.map,
      scale: c?.scale?.x,
    };
  });
  out.push({ q, ...s });
  await page.close();
}
console.log(JSON.stringify(out, null, 2));
await browser.disconnect();
