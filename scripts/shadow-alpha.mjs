import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9237';
const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 650 });
await page.goto(`http://127.0.0.1:5280/?cb=${Date.now()}&model=/models/xun/%E6%B5%94.pmx`, {
  waitUntil: 'domcontentloaded',
  timeout: 90000,
});
await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
await new Promise((r) => setTimeout(r, 2200));

const info = await page.evaluate(() => {
  const c = window.__poser.contactShadow;
  const img = c.material.map?.image;
  let samples = null;
  if (img && img.getContext) {
    const ctx = img.getContext('2d');
    const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    samples = { size: [img.width, img.height], center: at(128, 128), mid: at(180, 128), edge: at(250, 128) };
  }
  return {
    hasImage: !!img,
    samples,
    mapEncoding: c.material.map?.colorSpace,
    transparent: c.material.transparent,
    blending: c.material.blending,
    opacity: c.material.opacity,
    visible: c.visible,
    renderOrder: c.renderOrder,
  };
});
console.log(JSON.stringify(info, null, 2));

// 保留贴图、把阴影染成红色，验证 alpha 是否生效
await page.evaluate(() => {
  const c = window.__poser.contactShadow;
  c.material.color.setHex(0xff0000);
  c.material.opacity = 1;
  c.scale.set(1.4, 1.4, 1);
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: 'shots/shadow-red-with-map.png' });

await page.close();
await browser.disconnect();
