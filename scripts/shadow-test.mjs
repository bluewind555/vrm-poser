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

const snap = async (name) => {
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `shots/${name}.png` });
};

// 1) 去掉贴图，纯黑不透明 —— 应该能看到黑色圆斑
await page.evaluate(() => {
  const c = window.__poser.contactShadow;
  window.__savedMap = c.material.map;
  c.material.map = null;
  c.material.color.setHex(0x000000);
  c.material.opacity = 1;
  c.material.needsUpdate = true;
  c.scale.set(1.4, 1.4, 1);
});
await snap('shadow-t1-noMap');

// 2) 贴图放回去 + needsUpdate —— 如果这一张和上面一样，说明贴图没问题、只是"黑对黑"看不见
await page.evaluate(() => {
  const c = window.__poser.contactShadow;
  c.material.map = window.__savedMap;
  c.material.color.setHex(0xffffff);
  c.material.needsUpdate = true;
});
await snap('shadow-t2-withMap');

// 3) 贴图 + 红色 —— 应该看到红色圆斑（alpha 生效）
await page.evaluate(() => {
  const c = window.__poser.contactShadow;
  c.material.color.setHex(0xff0000);
  c.material.needsUpdate = true;
});
await snap('shadow-t3-redMap');

console.log('done');
await page.close();
await browser.disconnect();
