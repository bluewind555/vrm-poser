import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://localhost:5273/';
const MODEL = 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(poseUrl) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 800 });
    // 清掉 localStorage，确保用的是代码里的默认值
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.clear();
      } catch {}
    });
    const logs = [];
    page.on('console', (m) => {
      if (m.text().includes('[pmx]')) logs.push(m.text());
    });
    await page.goto(BASE + (poseUrl ? `?pose=${poseUrl}&` : '?') + MODEL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
    await sleep(1500);

    const m = await page.evaluate(() => {
      const a = window.__poser.avatar;
      const V = window.__THREE.Vector3;
      const pos = (n) => {
        const b = a.getBoneWorldPosition ? a.getBoneWorldPosition(n, new V()) : null;
        return b ? [b.x, b.y, b.z].map((v) => +v.toFixed(3)) : null;
      };
      const head = pos('head');
      const hips = pos('hips');
      const knee = pos('leftLowerLeg');
      const foot = pos('leftFoot');
      const dist = (p, q) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) : null);
      // 网格包围盒（绑定姿势，但能反映缩放/变形是否异常）
      const box = new window.__THREE.Box3().setFromObject(a.mesh ?? a.root);
      // 实际显示用的明暗/描边参数
      const mat = a.mesh?.material?.[0];
      return {
        head,
        hips,
        knee,
        foot,
        torso: dist(head, hips),
        thigh: dist(hips, knee),
        shin: dist(knee, foot),
        boxHeight: +(box.max.y - box.min.y).toFixed(3),
        outlineThickness: mat?.userData?.outlineParameters?.thickness ?? null,
        outlineVisible: mat?.userData?.outlineParameters?.visible ?? null,
        matType: mat?.type ?? null,
      };
    });
    console.log(JSON.stringify({ pose: poseUrl || 'neutral', ...m, logs: logs.join(' | ') }));
    return m;
  } finally {
    await page.close().catch(() => {});
  }
}

const stand = await measure(null);
const sit = await measure('/poses/sit.json');
console.log('--- 对比 ---');
console.log(
  JSON.stringify({
    torsoDelta: +(sit.torso - stand.torso).toFixed(3),
    boxDelta: +(sit.boxHeight - stand.boxHeight).toFixed(3),
    verdict: Math.abs(sit.torso - stand.torso) < 0.05 ? '躯干长度一致（未拉长）' : '躯干被改变（可能拉长）',
  }),
);

await browser.disconnect();

