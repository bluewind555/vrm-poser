import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const VIEWS = ['front', 'side', 'diag', 'high', 'low'];
const statusEl = document.getElementById('status');
const log = (msg) => {
  statusEl.textContent = msg;
  console.log('[pose-test]', msg);
};

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('load failed ' + src));
    img.src = src;
  });
}

/** 线稿 → 体块图（暗线压深灰、背景提亮、再模糊） */
function toBodyBlur(img, blurPx = 6) {
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
    const v = lum < 0.55 ? 90 : 235;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  octx.filter = `blur(${blurPx}px)`;
  octx.drawImage(cv, 0, 0);
  return out;
}

(async () => {
  try {
    const fileset = await FilesetResolver.forVisionTasks('/models/mediapipe/wasm');
    const mk = async (path, delegate = 'GPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate },
        runningMode: 'IMAGE',
        numPoses: 1,
      });

    log('加载 lite…');
    const lite = await mk('/models/mediapipe/pose_landmarker_lite.task');
    log('加载 full…');
    const full = await mk('/models/mediapipe/pose_landmarker_full.task');

    const out = {};
    for (const v of VIEWS) {
      const img = await loadImage(`/models/posedata/P001_${v}.png`);
      const body = toBodyBlur(img);
      let hit = null;
      let which = null;
      for (const [name, lm] of [
        ['lite', lite],
        ['full', full],
      ]) {
        const t0 = performance.now();
        const res = lm.detect(body);
        const world = res.worldLandmarks?.[0] ?? null;
        const dt = Math.round(performance.now() - t0);
        if (world) {
          hit = world.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5), +(p.visibility ?? 0).toFixed(3)]);
          which = `${name} ${dt}ms`;
          break;
        }
      }
      out[v] = { found: !!hit, model: which, size: [img.naturalWidth, img.naturalHeight], world: hit };
      log(`${v}: ${hit ? '✓ ' + which : '✗'}`);
    }

    window.__landmarks = out;
    window.__done = true;
  } catch (err) {
    window.__error = err.message + '\n' + (err.stack || '');
    window.__done = true;
    log('失败：' + err.message);
  }
})();
