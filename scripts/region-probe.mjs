import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const MODEL = 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 800, height: 600 });
  await page.goto(`${BASE}?${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(1500);

  const out = await page.evaluate(() => {
    const a = window.__poser.avatar;
    const geo = a.mesh.geometry;
    const posA = geo.attributes.position.array;
    const siA = geo.attributes.skinIndex.array;
    const swA = geo.attributes.skinWeight.array;
    const names = a.skeleton.bones.map((b) => b.name);
    const n = posA.length / 3;

    const region = (pred) => {
      const hist = new Map();
      let count = 0;
      for (let v = 0; v < n; v++) {
        const x = posA[v * 3];
        const y = posA[v * 3 + 1];
        const z = posA[v * 3 + 2];
        if (!pred(x, y, z)) continue;
        count += 1;
        let mw = -1;
        let bi = -1;
        for (let k = 0; k < 4; k++) {
          const w = swA[v * 4 + k];
          if (w > mw) { mw = w; bi = siA[v * 4 + k]; }
        }
        if (bi < 0) continue;
        hist.set(bi, (hist.get(bi) ?? 0) + 1);
      }
      const top = [...hist.entries()]
        .sort((p, q) => q[1] - p[1])
        .slice(0, 5)
        .map(([i, c]) => ({ i, name: names[i] ?? 'oob', c }));
      return { count, top };
    };

    return {
      // 左大腿：x>0.03，y 在 0.45~0.85
      leftThigh: region((x, y) => x > 0.03 && y > 0.45 && y < 0.85),
      // 左小腿：x>0.03，y 在 0.12~0.45
      leftShin: region((x, y) => x > 0.03 && y > 0.12 && y < 0.45),
      // 头部：y > 1.35
      head: region((x, y) => y > 1.35),
      namesSample: names.slice(25, 36),
    };
  });
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
