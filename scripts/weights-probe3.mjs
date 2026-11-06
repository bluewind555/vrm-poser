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
    const attrs = Object.keys(geo.attributes);
    const pos = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const names = a.skeleton.bones.map((b) => b.name);

    const dump = (v) => ({
      v,
      pos: [pos.getX(v), pos.getY(v), pos.getZ(v)].map((n) => Math.round(n * 1000) / 1000),
      si: [0, 1, 2, 3].map((k) => si.getX(v * 4 + k)),
      sw: [0, 1, 2, 3].map((k) => Math.round(sw.getX(v * 4 + k) * 1000) / 1000),
    });

    // 统计 skinIndex 出现频次（取 4 个槽里权重最大的那个）
    const hist = new Map();
    let nan = 0;
    for (let v = 0; v < pos.count; v++) {
      let maxW = -1;
      let bi = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getX(v * 4 + k);
        if (!Number.isFinite(w)) { nan += 1; continue; }
        if (w > maxW) { maxW = w; bi = si.getX(v * 4 + k); }
      }
      if (bi < 0) continue;
      hist.set(bi, (hist.get(bi) ?? 0) + 1);
    }
    const top = [...hist.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 12)
      .map(([idx, count]) => ({ idx, name: names[idx] ?? 'oob', count }));

    return {
      attrs,
      vertexCount: pos.count,
      counts: { skinIndex: si.count, skinWeight: sw.count, itemSize: [si.itemSize, sw.itemSize] },
      samples: [dump(0), dump(1000), dump(20000), dump(40000)].filter((s) => s.v < pos.count),
      nanWeights: nan,
      top,
      legBoneIndices: ['左足', '左ひざ', '左足首', '左つま先'].map((n) => ({ n, i: names.indexOf(n) })),
    };
  });
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
