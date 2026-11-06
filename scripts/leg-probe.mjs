import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const MODEL = 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(`${BASE}?${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 30000 }).catch(() => {});
  await sleep(1200);

  // 侧面视角，能清楚看出腿是直是弯
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.8, 0);
    p.camera.position.set(3.4, 0.95, 0.1);
    p.controls.update();
  });
  await sleep(400);
  await page.screenshot({ path: 'shots/leg-a-before.png' });

  // 只在左侧大腿上转 -90°
  await page.evaluate(() => {
    const sel = document.getElementById('bone');
    sel.value = 'leftUpperLeg';
    sel.dispatchEvent(new Event('change'));
    const x = document.getElementById('rot-x');
    x.value = '-90';
    x.dispatchEvent(new Event('input'));
    window.__legSet = true;
  });
  await sleep(900);
  const applied = await page.evaluate(() => {
    const a = window.__poser.avatar;
    const T = window.__THREE;
    const hip = a.getBoneWorldPosition('leftUpperLeg', new T.Vector3());
    const knee = a.getBoneWorldPosition('leftLowerLeg', new T.Vector3());
    const ankle = a.getBoneWorldPosition('leftFoot', new T.Vector3());
    // 左腿蒙皮顶点的包围盒（用 CPU 蒙皮近似：取该骨骼权重最大的前 500 个顶点）
    const geo = a.mesh.geometry;
    const pos = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const boneIdx = a.skeleton.bones.findIndex((b) => b.name === '左足');
    const mats = a.skeleton.bones.map((b, i) => new T.Matrix4().multiplyMatrices(b.matrixWorld, a.skeleton.boneInverses[i]));
    const box = new T.Box3();
    let count = 0;
    for (let v = 0; v < pos.count && count < 800; v++) {
      let maxW = 0;
      let bi = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getX(v * 4 + k);
        if (w > maxW) { maxW = w; bi = si.getX(v * 4 + k); }
      }
      if (bi !== boneIdx || maxW < 0.2) continue;
      const m = mats[bi].elements;
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      box.expandByPoint(new T.Vector3(
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ));
      count += 1;
    }
    return {
      sliderValue: document.getElementById('rot-x').value,
      boneName: a.skeleton.bones[boneIdx]?.name ?? null,
      hip: [hip.x, hip.y, hip.z].map((n) => +n.toFixed(3)),
      knee: [knee.x, knee.y, knee.z].map((n) => +n.toFixed(3)),
      ankle: [ankle.x, ankle.y, ankle.z].map((n) => +n.toFixed(3)),
      legVerticesSampled: count,
      legBox: { min: box.min.toArray().map((n) => +n.toFixed(3)), max: box.max.toArray().map((n) => +n.toFixed(3)) },
    };
  });
  console.log('APPLIED', JSON.stringify(applied, null, 2));
  await sleep(600);
  await page.screenshot({ path: 'shots/leg-b-rotated.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}



