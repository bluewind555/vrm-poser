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

    const tally = new Map();
    // 只看下半身区域的顶点（绑定姿势 y < 0.95 且权重集中度 > 0.3）
    let legVerts = 0;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      if (y > 0.95) continue;
      legVerts += 1;
      let maxW = 0;
      let bi = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getX(v * 4 + k);
        if (w > maxW) {
          maxW = w;
          bi = si.getX(v * 4 + k);
        }
      }
      if (bi < 0 || maxW < 0.3) continue;
      const n = names[bi] ?? `#${bi}`;
      tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a2, b2) => b2[1] - a2[1]).slice(0, 14);

    // 指定几根关键骨的直接权重顶点数（不看是否主权重）
    const countByBone = {};
    for (const target of ['左足', '左ひざ', '左足首', '下半身', '腰キャンセル左', '左つま先']) {
      const idx = names.indexOf(target);
      let c = 0;
      let strong = 0;
      if (idx >= 0) {
        for (let v = 0; v < pos.count; v++) {
          for (let k = 0; k < 4; k++) {
            if (si.getX(v * 4 + k) === idx && sw.getX(v * 4 + k) > 0.01) {
              c += 1;
              if (sw.getX(v * 4 + k) > 0.5) strong += 1;
            }
          }
        }
      }
      countByBone[target] = { idx, anyWeight: c, weightOver50: strong };
    }

    return { legVerts, top, countByBone };
  });
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
