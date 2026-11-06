import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { fuseViews } from './img2pose.js';

const statusEl = document.getElementById('status');
const log = (m) => {
  statusEl.textContent = m;
  console.log('[batch]', m);
};

const VIEWS = ['front', 'side', 'high'];

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('load failed ' + src));
    img.src = src;
  });
}

/** 线稿 → 体块图（同 imagepose.js 的处理） */
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
    const meta = await (await fetch('/models/batch/meta.json')).json();
    log(`共 ${meta.length} 组姿势`);

    const fileset = await FilesetResolver.forVisionTasks('/models/mediapipe/wasm');
    const mk = (path, delegate) =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: path, delegate },
        runningMode: 'IMAGE',
        numPoses: 1,
      });
    let lm;
    try {
      lm = await mk('/models/mediapipe/pose_landmarker_lite.task', 'GPU');
    } catch {
      lm = await mk('/models/mediapipe/pose_landmarker_lite.task', 'CPU');
    }
    log('PoseLandmarker 就绪');

    const result = {};
    for (const pose of meta) {
      const views = [];
      for (const v of VIEWS) {
        let img;
        try {
          img = await loadImage(`/models/batch/${pose.id}/${v}.png`);
        } catch {
          continue; // 这张没下载到
        }
        const res = lm.detect(toBodyBlur(img));
        const world = res.worldLandmarks?.[0];
        if (world) views.push({ name: v, world: world.map((p) => [p.x, p.y, p.z, p.visibility ?? 1]) });
      }
      const fused = views.length ? fuseViews(views) : null;
      result[pose.id] = { name: pose.name, category: pose.category, viewCount: views.length, fused };
      log(`${pose.id} ${pose.name}：${views.length}/${VIEWS.length} 视图${fused ? '' : '（未检出）'}`);
    }
    window.__batch = result;
    window.__done = true;
    log('全部完成');
  } catch (err) {
    window.__error = err.message + '\n' + (err.stack || '');
    window.__done = true;
    log('失败：' + err.message);
  }
})();
