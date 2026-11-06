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
    const bones = a.skeleton.bones;
    const names = bones.map((b) => b.name);
    const idxOf = (n) => names.indexOf(n);

    const chainOf = (n) => {
      const out2 = [];
      let i = idxOf(n);
      let guard = 0;
      while (i >= 0 && bones[i] && guard < 8) {
        const b = bones[i];
        const p = b.parent;
        const pi = p && p.isBone ? names.indexOf(p.name) : -1;
        out2.push(`${b.name}#${i}`);
        i = pi;
        guard += 1;
      }
      return out2.join(' ← ');
    };

    // 每根骨的支配顶点数
    const geo = a.mesh.geometry;
    const si = geo.attributes.skinIndex.array;
    const sw = geo.attributes.skinWeight.array;
    const count = new Int32Array(bones.length);
    const nVerts = geo.attributes.position.count;
    for (let v = 0; v < nVerts; v++) {
      let mw = -1;
      let bi = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw[v * 4 + k];
        if (w > mw) { mw = w; bi = si[v * 4 + k]; }
      }
      if (bi >= 0 && mw > 0.2) count[bi] += 1;
    }

    const interested = ['左足', '左足02', '左足D', '左ひざ', '左ひざD', '左足首', '左足首D', '左つま先', '左つま先D', '下半身', '腰キャンセル左'];
    const table = interested.map((n) => {
      const i = idxOf(n);
      return { name: n, idx: i, verts: i >= 0 ? count[i] : null, chain: i >= 0 ? chainOf(n) : '(不存在)' };
    });

    return { table, totalBones: bones.length };
  });
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
