import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const statusEl = document.getElementById('status');
const log = (m) => {
  statusEl.textContent = m;
  console.log('[probe]', m);
};

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('load failed ' + src));
    img.src = src;
  });
}

/** 可调参数的"体块化"：阈值、模糊、对比 */
function variant(img, { thresh = 0.55, dark = 90, light = 235, blur = 6, contrast = 1 }) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    const v = lum < thresh ? dark : light;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  octx.filter = `blur(${blur}px) contrast(${contrast})`;
  octx.drawImage(cv, 0, 0);
  return out;
}

const VARIANTS = [
  { name: '默认 b6', opts: {} },
  { name: 'b3', opts: { blur: 3 } },
  { name: 'b10', opts: { blur: 10 } },
  { name: 'b6 深色', opts: { dark: 40, thresh: 0.7 } },
  { name: 'b6 反相', opts: { dark: 220, light: 40 } },
  { name: 'b6 对比', opts: { contrast: 1.8 } },
];

(async () => {
  try {
    const meta = await (await fetch('/models/batch/meta.json')).json();
    const target = meta.find((m) => m.id === 'P050') ?? meta[0];
    log(`测试 ${target.id} ${target.name}`);

    const fileset = await FilesetResolver.forVisionTasks('/models/mediapipe/wasm');
    const mk = (path) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
      });
    const lite = await mk('/models/mediapipe/pose_landmarker_lite.task');
    const full = await mk('/models/mediapipe/pose_landmarker_full.task');

    const out = {};
    for (const view of ['front', 'side', 'high']) {
      let img;
      try {
        img = await loadImage(`/models/batch/${target.id}/${view}.png`);
      } catch {
        continue;
      }
      const rows = [];
      for (const v of VARIANTS) {
        const canvas = variant(img, v.opts);
        for (const [mName, lm] of [
          ['lite', lite],
          ['full', full],
        ]) {
          const r = lm.detect(canvas);
          const ok = !!r.worldLandmarks?.[0];
          rows.push({ variant: v.name, model: mName, ok });
        }
      }
      out[view] = rows;
      const hits = rows.filter((r) => r.ok).map((r) => `${r.variant}/${r.model}`);
      log(`${view}: ${hits.length ? '✓ ' + hits.join(', ') : '全部失败'}`);
    }
    window.__probe = out;
    window.__done = true;
  } catch (err) {
    window.__error = err.message;
    window.__done = true;
  }
})();
