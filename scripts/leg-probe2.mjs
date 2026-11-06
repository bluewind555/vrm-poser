import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const MODEL = 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1100, height: 800 });
  await page.goto(`${BASE}?${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(1500);

  const probe = () =>
    page.evaluate(() => {
      const a = window.__poser.avatar;
      const T = window.__THREE;
      const geo = a.mesh.geometry;
      const posA = geo.attributes.position.array;
      const siA = geo.attributes.skinIndex.array;
      const swA = geo.attributes.skinWeight.array;
      const names = a.skeleton.bones.map((b) => b.name);
      const legIdx = names.indexOf('左足');

      // 统计主权重骨
      const hist = new Map();
      for (let v = 0; v < posA.length / 3; v++) {
        let mw = -1;
        let bi = -1;
        for (let k = 0; k < 4; k++) {
          const w = swA[v * 4 + k];
          if (w > mw) { mw = w; bi = siA[v * 4 + k]; }
        }
        if (bi >= 0 && mw > 0.2) hist.set(bi, (hist.get(bi) ?? 0) + 1);
      }
      const top = [...hist.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([i, c]) => `${names[i]}:${c}`);

      // 左大腿主导顶点的世界坐标包围盒
      const mats = a.skeleton.bones.map((b, i) => {
        const m = new T.Matrix4().multiplyMatrices(b.matrixWorld, a.skeleton.boneInverses[i]);
        return m.elements;
      });
      const box = new T.Box3();
      let n = 0;
      for (let v = 0; v < posA.length / 3; v++) {
        let mw = -1;
        let bi = -1;
        for (let k = 0; k < 4; k++) {
          const w = swA[v * 4 + k];
          if (w > mw) { mw = w; bi = siA[v * 4 + k]; }
        }
        if (bi !== legIdx || mw < 0.2) continue;
        n += 1;
        const e = mats[bi];
        const x = posA[v * 3];
        const y = posA[v * 3 + 1];
        const z = posA[v * 3 + 2];
        box.expandByPoint(
          new T.Vector3(
            e[0] * x + e[4] * y + e[8] * z + e[12],
            e[1] * x + e[5] * y + e[9] * z + e[13],
            e[2] * x + e[6] * y + e[10] * z + e[14],
          ),
        );
      }
      const knee = a.getBoneWorldPosition('leftLowerLeg', new T.Vector3());
      return {
        top,
        legVerts: n,
        thighBox: n ? { min: box.min.toArray().map((v2) => +v2.toFixed(2)), max: box.max.toArray().map((v2) => +v2.toFixed(2)) } : null,
        knee: [knee.x, knee.y, knee.z].map((v2) => +v2.toFixed(3)),
        slider: document.getElementById('rot-x').value,
      };
    });

  console.log('BEFORE', JSON.stringify(await probe()));

  await page.evaluate(() => {
    const sel = document.getElementById('bone');
    sel.value = 'leftUpperLeg';
    sel.dispatchEvent(new Event('change'));
    const x = document.getElementById('rot-x');
    x.value = '-90';
    x.dispatchEvent(new Event('input'));
  });
  await sleep(900);
  console.log('AFTER ', JSON.stringify(await probe()));

  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.8, 0.2);
    p.camera.position.set(3.2, 0.9, 1.6);
    p.controls.update();
  });
  await sleep(500);
  await page.screenshot({ path: 'shots/leg-check.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
