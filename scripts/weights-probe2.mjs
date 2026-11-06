import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const MODEL = 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 900, height: 700 });
  await page.goto(`${BASE}?${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(1500);

  const out = await page.evaluate(() => {
    const a = window.__poser.avatar;
    const geo = a.mesh.geometry;
    const pos = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const names = a.skeleton.bones.map((b) => b.name);

    const dominant = new Map();
    let total = 0;
    let sumMax = 0;
    const samples = [];

    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      if (y > 0.9) continue; // 腿部区域
      total += 1;
      let maxW = -1;
      let bi = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getX(v * 4 + k);
        if (w > maxW) { maxW = w; bi = si.getX(v * 4 + k); }
      }
      sumMax += maxW;
      const key = `${bi}`;
      dominant.set(key, (dominant.get(key) ?? 0) + 1);
      if (samples.length < 5) {
        samples.push({
          v,
          pos: [pos.getX(v), pos.getY(v), pos.getZ(v)].map((n) => +n.toFixed(3)),
          idx: [0, 1, 2, 3].map((k) => si.getX(v * 4 + k)),
          w: [0, 1, 2, 3].map((k) => +sw.getX(v * 4 + k).toFixed(3)),
          name: names[bi],
        });
      }
    }

    const top = [...dominant.entries()]
      .map(([idx, count]) => ({ idx: Number(idx), name: names[Number(idx)] ?? '?', count }))
      .sort((x, y2) => y2.count - x.count)
      .slice(0, 10);

    return { legVertices: total, avgMaxWeight: +(sumMax / total).toFixed(3), top, samples };
  });
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
