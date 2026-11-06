import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

/**
 * 浏览器内的单图姿态估计（MediaPipe Pose Landmarker）。
 * 模型与 WASM 都放在 public/models/mediapipe/ 下，离线可用。
 */

let landmarkerPromise = null;

function createLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('/models/mediapipe/wasm');
      const make = (delegate) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/mediapipe/pose_landmarker_lite.task', delegate },
          runningMode: 'IMAGE',
          numPoses: 1,
        });
      try {
        return await make('GPU');
      } catch (err) {
        console.warn('[img2pose] GPU 委托失败，回退 CPU', err?.message);
        return await make('CPU');
      }
    })();
  }
  return landmarkerPromise;
}

/**
 * 线稿 → 体块图。
 * 人形检测器是在真实照片上训练的，纯线稿（白底黑线）基本检不出来；
 * 把暗线压成深灰、背景提亮，再高斯模糊，才近似出"有体积的人形"。
 */
export function preprocessToBody(img, blurPx = 6) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const ctx = src.getContext('2d');
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
  octx.drawImage(src, 0, 0);
  return out;
}

function loadImageFromFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

/**
 * 估计一张图片里的 3D 关键点。
 * @param {File|Blob} file
 * @returns {Promise<{world:number[][], ms:number}|null>}
 */
export async function estimatePoseFromImage(file) {
  const landmarker = await createLandmarker();
  const img = await loadImageFromFile(file);
  const canvas = preprocessToBody(img);

  const t0 = performance.now();
  const res = landmarker.detect(canvas);
  const ms = Math.round(performance.now() - t0);
  const world = res.worldLandmarks?.[0];
  if (!world) return null;
  return {
    ms,
    world: world.map((p) => [p.x, p.y, p.z, p.visibility ?? 1]),
  };
}
