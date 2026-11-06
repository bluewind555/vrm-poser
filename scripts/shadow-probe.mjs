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
await new Promise((r) => setTimeout(r, 2500));

const before = await page.screenshot({ path: 'shots/shadow-a.png' });

// 把接触阴影改成纯红、不透明、放大，看它到底有没有被画出来
const dbg = await page.evaluate(() => {
  const c = window.__poser.contactShadow;
  c.material.map = null;
  c.material.color.setHex(0xff0000);
  c.material.opacity = 1;
  c.material.needsUpdate = true;
  c.scale.set(1.2, 1.2, 1);
  c.visible = true;
  c.updateMatrixWorld(true);
  const box = new (window.__THREE.Box3)().setFromObject(c);
  return {
    visible: c.visible,
    inScene: !!c.parent,
    parentType: c.parent?.type,
    worldPos: c.getWorldPosition(new (window.__THREE.Vector3)()).toArray(),
    box: { min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)) },
    material: { transparent: c.material.transparent, depthTest: c.material.depthTest, depthWrite: c.material.depthWrite },
  };
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: 'shots/shadow-b.png' });
console.log('debug:', JSON.stringify(dbg, null, 2));
await page.close();
await browser.disconnect();
