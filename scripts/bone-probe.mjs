import puppeteer from 'puppeteer-core';

const URL = process.env.POSER_URL;
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 800, height: 600 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(1500);

  const probe = async (label) =>
    page.evaluate((label) => {
      const a = window.__poser.avatar;
      const names = ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'];
      const out = {};
      for (const n of names) {
        const proxy = a.humanoid?.getNormalizedBoneNode?.(n);
        const p = proxy ? proxy.getWorldPosition(new (proxy.position.constructor)()) : null;
        const real = a.getBoneWorldPosition?.(n, new (proxy?.position.constructor ?? Object)());
        out[n] = {
          proxy: p ? [p.x, p.y, p.z].map((v) => +v.toFixed(3)) : null,
          real: real ? [real.x, real.y, real.z].map((v) => +v.toFixed(3)) : null,
        };
      }
      // 也把腿骨的局部四元数打出来，看旋转到底有没有写进去
      const q = {};
      for (const n of ['leftUpperLeg', 'leftLowerLeg']) {
        const node = a.humanoid?.getNormalizedBoneNode?.(n);
        if (node) q[n] = node.quaternion.toArray().map((v) => +v.toFixed(3));
      }
      return { label, out, proxyQuat: q };
    }, label);

  console.log(JSON.stringify(await probe('sit'), null, 2));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
