import * as THREE from 'three';
import { parsePmxToBuffers } from './pmx-parse.js';

/**
 * 直接在网页里加载 PMX（MMD 模型），并把它接进本项目的"归一化骨骼"抽象。
 *
 * 分工：
 *   - `pmx-parse.js` 负责把 4~5 MB 二进制解析成 TypedArray（纯函数，不依赖 three）；
 *   - 这里只做装配：BufferGeometry / Bone 树 / 材质 / Skeleton / 代理骨架 / 每帧重定向。
 *
 * 解析没有放进 Web Worker：实测 Worker 版反而多 200 ms（传输+调度），总加载时间无可测改善，
 * 却让 Vite 的 worker 插件在解析真实路径时 exec 子进程（受限环境直接 spawn EPERM）。
 *
 * 为什么需要重定向：
 *   VRM 的归一化骨骼是"标准 T-pose + 单位四元数"，姿势数据是相对这个标准姿态的旋转；
 *   而 MMD 模型多为 A-pose（手臂下垂 30~45°），直接把 VRM 的四元数写上去会多叠一个偏移。
 * 做法：
 *   1. 按 VRM humanoid 层级造一棵"代理骨架"（标准 T-pose、局部旋转恒等），pose.js 只读写它；
 *   2. 每帧把代理骨架的世界朝向乘上"绑定位姿校正"再写回 MMD 真骨骼，
 *      并用"父骨骼当前世界朝向"求逆得到局部旋转，中间夹着的 捩/肩P 等骨骼不影响结果。
 */

// VRM humanoid 树
const HIERARCHY = {
  hips: ['spine', 'leftUpperLeg', 'rightUpperLeg'],
  spine: ['chest'],
  chest: ['upperChest'],
  upperChest: ['neck', 'leftShoulder', 'rightShoulder'],
  neck: ['head'],
  leftShoulder: ['leftUpperArm'],
  leftUpperArm: ['leftLowerArm'],
  leftLowerArm: ['leftHand'],
  rightShoulder: ['rightUpperArm'],
  rightUpperArm: ['rightLowerArm'],
  rightLowerArm: ['rightHand'],
  leftUpperLeg: ['leftLowerLeg'],
  leftLowerLeg: ['leftFoot'],
  leftFoot: ['leftToes'],
  rightUpperLeg: ['rightLowerLeg'],
  rightLowerLeg: ['rightFoot'],
  rightFoot: ['rightToes'],
};

// 标准 T-pose 下的局部偏移（米），只用于代理骨架的世界坐标（接地校正要用）
const PROXY_OFFSETS = {
  hips: [0, 0.95, 0],
  spine: [0, 0.12, 0],
  chest: [0, 0.13, 0],
  upperChest: [0, 0.12, 0],
  neck: [0, 0.13, 0],
  head: [0, 0.09, 0],
  leftShoulder: [0.05, 0.1, 0],
  leftUpperArm: [0.12, 0, 0],
  leftLowerArm: [0.26, 0, 0],
  leftHand: [0.24, 0, 0],
  rightShoulder: [-0.05, 0.1, 0],
  rightUpperArm: [-0.12, 0, 0],
  rightLowerArm: [-0.26, 0, 0],
  rightHand: [-0.24, 0, 0],
  leftUpperLeg: [0.09, -0.06, 0],
  leftLowerLeg: [0, -0.42, 0],
  leftFoot: [0, -0.42, 0],
  leftToes: [0, -0.05, 0.1],
  rightUpperLeg: [-0.09, -0.06, 0],
  rightLowerLeg: [0, -0.42, 0],
  rightFoot: [0, -0.42, 0],
  rightToes: [0, -0.05, 0.1],
};

// 标准 T-pose 下的骨骼方向（用于和模型实际 rest 方向对齐）
const CANON_DIR = {
  hips: [0, 1, 0],
  spine: [0, 1, 0],
  chest: [0, 1, 0],
  upperChest: [0, 1, 0],
  neck: [0, 1, 0],
  head: [0, 1, 0],
  leftShoulder: [1, 0, 0],
  leftUpperArm: [1, 0, 0],
  leftLowerArm: [1, 0, 0],
  leftHand: [1, 0, 0],
  rightShoulder: [-1, 0, 0],
  rightUpperArm: [-1, 0, 0],
  rightLowerArm: [-1, 0, 0],
  rightHand: [-1, 0, 0],
  leftUpperLeg: [0, -1, 0],
  leftLowerLeg: [0, -1, 0],
  leftFoot: [0, 0, 1],
  leftToes: [0, 0, 1],
  rightUpperLeg: [0, -1, 0],
  rightLowerLeg: [0, -1, 0],
  rightFoot: [0, 0, 1],
  rightToes: [0, 0, 1],
};

// VRM 名 -> MMD 骨骼名候选（按优先级排列，加载时会用"实际权重顶点数"再择优）
// 很多 MMD 模型把网格绑在 "D 变形骨"（左ひざD / 左足02 / 左足首D）上，而动画骨（左足 / 左ひざ）
// 一个顶点都没有 —— 只按名字取第一个候选，就会出现"骨骼转了、腿不动"。
const MMD_BONE_NAMES = {
  hips: ['下半身', 'センター', '腰'],
  spine: ['上半身'],
  chest: ['上半身1', '上半身2', '上半身'],
  upperChest: ['上半身2', '上半身1'],
  neck: ['首'],
  head: ['頭'],
  leftShoulder: ['左肩', '左肩P'],
  leftUpperArm: ['左腕', '左腕02'],
  leftLowerArm: ['左ひじ', '左ひじD', '左肘'],
  leftHand: ['左手首', '左手首D'],
  rightShoulder: ['右肩', '右肩P'],
  rightUpperArm: ['右腕', '右腕02'],
  rightLowerArm: ['右ひじ', '右ひじD', '右肘'],
  rightHand: ['右手首', '右手首D'],
  leftUpperLeg: ['左足', '左足02', '左足D'],
  leftLowerLeg: ['左ひざ', '左ひざD', '左膝'],
  leftFoot: ['左足首', '左足首D'],
  leftToes: ['左つま先', '左つま先D'],
  rightUpperLeg: ['右足', '右足02', '右足D'],
  rightLowerLeg: ['右ひざ', '右ひざD', '右膝'],
  rightFoot: ['右足首', '右足首D'],
  rightToes: ['右つま先', '右つま先D'],
};

// 需要"方向校正"的骨骼（其余骨骼直接沿用代理朝向：MMD 的 rest 旋转本来就是恒等）
const NEEDS_ALIGN = new Set([
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg',
  'rightUpperLeg', 'rightLowerLeg',
  // 脚/趾不做方向校正：MMD 的脚本来朝前，而它的子骨骼常是 EX/辅助骨，
  // 算出来的方向会差 70°+，把鞋扭成麻花。
  'spine', 'chest', 'upperChest', 'neck',
]);

const TOPO_ORDER = (() => {
  const out = [];
  const walk = (name) => {
    out.push(name);
    for (const child of HIERARCHY[name] || []) walk(child);
  };
  walk('hips');
  return out;
})();

const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function texturePath(raw) {
  return String(raw).replace(/\\/g, '/');
}

/**
 * 解码 TGA（浏览器原生不支持 TGA，而很多 MMD 模型的贴图就是 .tga）。
 * 支持 未压缩(2/3) 与 RLE(10/11)，24/32 位，按 origin 位翻转成"从上到下"。
 * @returns {{width:number,height:number,data:Uint8ClampedArray}|null}
 */
function decodeTGA(buffer) {
  const u8 = new Uint8Array(buffer);
  if (u8.length < 18) return null;
  const idLen = u8[0];
  const cmapType = u8[1];
  const imgType = u8[2];
  const width = u8[12] | (u8[13] << 8);
  const height = u8[14] | (u8[15] << 8);
  const bpp = u8[16];
  const desc = u8[17];
  const bytes = Math.ceil(bpp / 8);
  if (!width || !height || bytes < 3) return null;

  let p = 18 + idLen;
  if (cmapType) p += u8[5] | (u8[6] << 8) | (u8[7] << 16);

  const total = width * height;
  const out = new Uint8ClampedArray(total * 4);
  const writeAt = (i, r, g, b, a) => {
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  };

  if (imgType === 2 || imgType === 3) {
    for (let i = 0; i < total; i++) {
      writeAt(i, u8[p + 2], u8[p + 1], u8[p], bytes === 4 ? u8[p + 3] : 255);
      p += bytes;
    }
  } else if (imgType === 10 || imgType === 11) {
    let i = 0;
    while (i < total && p < u8.length) {
      const hdr = u8[p++];
      const count = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        const b = u8[p];
        const g = u8[p + 1];
        const r = u8[p + 2];
        const a = bytes === 4 ? u8[p + 3] : 255;
        p += bytes;
        for (let k = 0; k < count && i < total; k++, i++) writeAt(i, r, g, b, a);
      } else {
        for (let k = 0; k < count && i < total; k++, i++) {
          writeAt(i, u8[p + 2], u8[p + 1], u8[p], bytes === 4 ? u8[p + 3] : 255);
          p += bytes;
        }
      }
    }
  } else {
    return null;
  }

  // bit5 = 0 表示原点在左下，需要垂直翻转
  const bottomOrigin = (desc & 0x20) === 0;
  if (bottomOrigin) {
    const row = width * 4;
    const tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const a = y * row;
      const b = (height - 1 - y) * row;
      tmp.set(out.subarray(a, a + row));
      out.copyWithin(a, b, b + row);
      out.set(tmp, b);
    }
  }
  return { width, height, data: out };
}

function tgaToCanvas(tga) {
  const canvas = document.createElement('canvas');
  canvas.width = tga.width;
  canvas.height = tga.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(tga.width, tga.height);
  img.data.set(tga.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}


// ---------- 解析 ----------
// 曾经把解析放进 Web Worker，实测：主线程 650 ms vs Worker 850 ms（多 200 ms 传输/调度），
// 总加载时间没有可测量的改善，却让 Vite 的 worker 插件在解析真实路径时去 exec 子进程
// （受限环境里直接 spawn EPERM，dev / build 都会挂）。所以回退为主线程解析。
async function fetchAndParse(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PMX 下载失败 HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();

  const t0 = performance.now();
  const data = parsePmxToBuffers(buffer);
  const t1 = performance.now();
  window.__pmxParse = { mode: 'main', ms: Math.round(t1 - t0), window: [t0, t1] };
  console.log('[pmx] 解析完成', { ms: Math.round(t1 - t0) });
  return data;
}

function buildProxyRig() {
  const nodes = new Map();
  const proxyRoot = new THREE.Group();
  proxyRoot.name = 'proxyRig';
  const make = (name, parent) => {
    const obj = new THREE.Object3D();
    obj.name = `proxy:${name}`;
    const off = PROXY_OFFSETS[name] || [0, 0, 0];
    obj.position.set(off[0], off[1], off[2]);
    (parent || proxyRoot).add(obj);
    nodes.set(name, obj);
    return obj;
  };
  make('hips', null);
  for (const name of TOPO_ORDER) {
    if (name === 'hips') continue;
    const parent = TOPO_ORDER.find((n) => (HIERARCHY[n] || []).includes(name));
    make(name, nodes.get(parent));
  }
  return { root: proxyRoot, nodes };
}

/**
 * @param {string} url   .pmx 的地址（也支持 blob: URL）
 * @param {string|((rel: string) => string|null)} basePath
 *        贴图目录（以 / 结尾，例如 '/models/weilina/'），
 *        或一个解析函数：给相对路径返回可用 URL / null（本地文件夹上传时用）
 */
export async function loadPMX(url, basePath = '') {
  const data = await fetchAndParse(url);
  const { scale, badIndex } = data;
  console.log('[pmx] 解析完成', data.counts);

  // ---------- 几何（数据来自 Worker，零拷贝转移） ----------
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(data.skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(data.skinWeights, 4));
  geometry.setIndex(new THREE.BufferAttribute(data.index, 1));

  // ---------- 骨骼 ----------
  const bones = data.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.set(b.position[0] * scale, b.position[1] * scale, b.position[2] * scale);
    return bone;
  });

  const armature = new THREE.Group();
  armature.name = 'pmxArmature';
  const roots = [];
  data.bones.forEach((b, i) => {
    const parent = b.parentIndex;
    if (parent >= 0 && bones[parent]) {
      bones[parent].add(bones[i]);
      // Bone.add 不改坐标，这里把绝对坐标换成相对父骨骼的局部坐标
      bones[i].position.set(
        (b.position[0] - data.bones[parent].position[0]) * scale,
        (b.position[1] - data.bones[parent].position[1]) * scale,
        (b.position[2] - data.bones[parent].position[2]) * scale,
      );
    } else {
      roots.push(bones[i]);
    }
  });
  for (const r of roots) armature.add(r);

  // ---------- 材质 ----------
  // MMD 贴图不统一：脸/发/睫毛用带 alpha 的贴图，身体/衣服不透明。
  // 一刀切 alphaTest 会把不透明材质的三角面裁掉（模型"碎掉"），
  // 一刀切不裁又会让脸的透明区域渲染成黑色。所以按贴图实际 alpha 采样决定。
  const texLoader = new THREE.TextureLoader();
  const params = new URLSearchParams(location.search);
  const matMode = params.get('mat');

  // 球面贴图（高光/反射）：?sph=0 关闭，?sph=0.8 调强度
  const sphParam = params.get('sph');
  const sphStrength = sphParam === null ? 0.55 : Math.max(0, Math.min(1.5, Number(sphParam) || 0));
  const sphEnabled = sphStrength > 0;

  // 贴图格式：优先 WebP（ffmpeg 转过的话体积小一个数量级、解码也快），
  // 默认自动探测：拿第一个贴图探一次，存在就用 WebP，否则用 PNG 原图。
  const toWebPPath = (rel) => rel.replace(/(^|\/)Texture\//, '$1Texture_webp/').replace(/\.png$/i, '.webp');
  const texMode = params.get('tex');
  const resolveResource = (rel) => (typeof basePath === 'function' ? basePath(rel) : (basePath || '') + rel);
  let useWebP = texMode === 'webp';
  if (!texMode) {
    const probeRaw = data.textures.find((t) => /\.png$/i.test(t));
    if (probeRaw) {
      const probeUrl = resolveResource(toWebPPath(texturePath(probeRaw)));
      if (typeof basePath === 'function') {
        // 本地文件夹模式：resolver 返回 null 就说明没有这个文件
        useWebP = !!probeUrl;
      } else if (probeUrl) {
        try {
          useWebP = (await fetch(probeUrl, { method: 'HEAD' })).ok;
        } catch {
          useWebP = false;
        }
      }
    }
  }
  if (useWebP) console.log('[pmx] 使用 WebP 贴图');
  const texPathOf = (raw) => {
    const rel = texturePath(raw);
    const want = useWebP ? toWebPPath(rel) : rel;
    const hit = resolveResource(want);
    // WebP 缺失时回退原图
    return hit || resolveResource(rel) || null;
  };

  const texCache = new Map();
  const texHasAlpha = new Map();
  const matsByPath = new Map();
  const texStats = { loaded: 0, total: 0, failed: 0 };
  window.__pmxTextures = texStats;

  const hasTransparentPixels = (image) => {
    try {
      const w = 64;
      const h = 64;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      const pixels = ctx.getImageData(0, 0, w, h).data;
      let transparent = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 128) transparent += 1;
      }
      return transparent / (pixels.length / 4) > 0.02;
    } catch (err) {
      console.warn('[pmx] alpha 采样失败，按不透明处理', err?.message);
      return false;
    }
  };

  const applyAlphaMode = (path) => {
    const has = texHasAlpha.get(path);
    if (has === undefined) return;
    for (const mat of matsByPath.get(path) || []) {
      mat.alphaTest = has ? 0.5 : 0;
      // 有 alpha 裁剪的材质走 alpha-to-coverage：配合 MSAA 把发丝/蕾丝边缘做平滑，
      // 比硬 alphaTest 少一圈锯齿（需要 renderer antialias 打开）
      mat.alphaToCoverage = has && mat.transparent === false;
      // 透明材质不描边：外扩会把 alpha 区域也描上，头发会变成一团黑边。
      // 注意必须 **合并** 而不是整体替换 —— 面板已经写进去的 thickness 不能被冲掉。
      mat.userData.outlineParameters = {
        ...(mat.userData.outlineParameters || {}),
        visible: !has,
      };
      mat.needsUpdate = true;
    }
  };

  /** 贴图彻底失败：把引用它的材质退回漫反射纯色，别留一块黑 */
  const failTexture = (path, why) => {
    texStats.loaded += 1;
    texStats.failed += 1;
    console.warn('[pmx] 贴图加载失败', path, why || '');
    for (const m of matsByPath.get(path) || []) {
      m.map = null;
      m.needsUpdate = true;
    }
  };

  const loadTexture = (idx) => {
    if (idx == null || idx < 0) return null;
    const raw = data.textures[idx];
    if (!raw) return null;
    const path = texPathOf(raw);
    if (!path) {
      texStats.total += 1;
      texStats.loaded += 1;
      texStats.failed += 1;
      console.warn('[pmx] 找不到贴图文件:', raw, '（会用纯色代替）');
      return null;
    }
    if (texCache.has(path)) return texCache.get(path);
    texStats.total += 1;

    // TGA 浏览器不支持，自己解码
    if (/\.tga$/i.test(path)) {
      const tex = new THREE.Texture();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.anisotropy = 8;
      texCache.set(path, tex);
      fetch(path)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((buf) => {
          const tga = decodeTGA(buf);
          if (!tga) throw new Error('TGA 解码失败');
          const canvas = tgaToCanvas(tga);
          tex.image = canvas;
          tex.needsUpdate = true;
          texStats.loaded += 1;
          texHasAlpha.set(path, hasTransparentPixels(canvas));
          applyAlphaMode(path);
        })
        .catch((err) => failTexture(path, err?.message));
      return tex;
    }

    const tex = texLoader.load(
      path,
      (loaded) => {
        texStats.loaded += 1;
        texHasAlpha.set(path, hasTransparentPixels(loaded.image));
        applyAlphaMode(path);
      },
      undefined,
      (err) => failTexture(path, err?.message),
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = 8;
    texCache.set(path, tex);
    return tex;
  };

  // MMD 的贴图本身就是"烘焙好光影"的 toon 图，用 PBR + ACES 色调映射去渲染等于把颜色压灰一遍。
  // 默认走 MeshToonMaterial（三段色阶）+ toneMapped=false，颜色才是贴图原本的样子。
  const makeToonGradient = (steps) => {
    const tex = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };
  // 强色阶：最低 0.35，会明显压暗，仅作对比
  const toonGradient = makeToonGradient([90, 165, 225, 255]);

  // 默认用的"柔和色阶"：下限由「渲染调节 → 立体度」实时改（1.0 = 纯平，0.55 = 强对比）
  const softSteps = new Uint8Array([217, 238, 250, 255]);
  const softGradient = new THREE.DataTexture(softSteps, softSteps.length, 1, THREE.RedFormat);
  softGradient.minFilter = THREE.NearestFilter;
  softGradient.magFilter = THREE.NearestFilter;
  softGradient.generateMipmaps = false;
  softGradient.needsUpdate = true;

  let shadingFloor = 0.85;
  const setShadingFloor = (floor) => {
    const f = Math.min(1, Math.max(0, Number(floor) || 0));
    shadingFloor = f;
    for (let i = 0; i < softSteps.length; i++) {
      const t = i / (softSteps.length - 1);
      softSteps[i] = Math.round(255 * (f + (1 - f) * t));
    }
    softGradient.needsUpdate = true;
  };
  setShadingFloor(shadingFloor);

  // PMX 材质自带描边粗细（edgeSize）与颜色（edgeColor）。
  // 按模型内的中位数归一化：多数材质维持原粗细，其余按作者意图变细/变粗。
  const edgeSizes = data.materials
    .map((m) => m.edgeSize ?? 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const edgeMedian = edgeSizes.length ? edgeSizes[Math.floor(edgeSizes.length / 2)] : 1;

  const materials = data.materials.map((m) => {
    const alpha = m.diffuse[3] ?? 1;
    const doubleSided = (m.flag & 1) !== 0;
    const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    if (matMode === 'normal') return new THREE.MeshNormalMaterial({ side: THREE.FrontSide });

    const keepMap = matMode !== 'basic';
    const noAlpha = matMode === 'noalpha';
    const map = keepMap ? loadTexture(m.textureIndex) : null;
    const color = keepMap
      ? new THREE.Color(m.diffuse[0], m.diffuse[1], m.diffuse[2])
      : new THREE.Color(0xcccccc);
    const common = {
      name: m.name,
      map,
      color,
      side,
      transparent: noAlpha ? false : alpha < 0.999,
      opacity: noAlpha ? 1 : alpha,
      alphaTest: 0,
      depthWrite: true,
    };

    let mat;
    if (matMode === 'standard') {
      // PBR + 全局 ACES 色调映射：偏灰、发闷，留作对比
      mat = new THREE.MeshStandardMaterial({ ...common, roughness: 0.82, metalness: 0 });
      mat.toneMapped = true;
    } else if (matMode === 'toon') {
      // 强色阶：会二次压暗（贴图里已经有明暗），只作对比
      mat = new THREE.MeshToonMaterial({ ...common, gradientMap: toonGradient });
      mat.toneMapped = false;
    } else if (matMode === 'unlit') {
      // 纯贴图色，完全不吃光照
      mat = new THREE.MeshBasicMaterial(common);
      mat.toneMapped = false;
    } else {
      // 默认 soft：吃光照但色阶下限很高（0.86），所以既有一点体积明暗，又不会把颜色压灰。
      mat = new THREE.MeshToonMaterial({ ...common, gradientMap: softGradient });
      mat.toneMapped = false;
    }

    // ---------- 球面贴图（SPH / SPA） ----------
    // MMD 用"视空间法线"采样一张球面贴图来伪造反射：加法(2)做高光、乘法(1)做环境色、
    // SPA(3) 用 alpha 做叠层。没有这一步，头发/金属件就只剩贴图固有色，看着很"塑料"。
    // 用 onBeforeCompile 注入一次采样，不改变材质本身的管线。
    const envIdx = m.envTextureIndex ?? -1;
    const envMode = m.envFlag ?? 0;
    if (keepMap && sphEnabled && envIdx >= 0 && envMode > 0 && (mat.isMeshToonMaterial || mat.isMeshStandardMaterial)) {
      const sphTex = loadTexture(envIdx);
      if (sphTex) {
        const sphUniforms = {
          uSphMap: { value: sphTex },
          uSphMode: { value: envMode },
          uSphStrength: { value: sphStrength },
        };
        mat.userData.sph = sphUniforms;
        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uSphMap = sphUniforms.uSphMap;
          shader.uniforms.uSphMode = sphUniforms.uSphMode;
          shader.uniforms.uSphStrength = sphUniforms.uSphStrength;
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
uniform sampler2D uSphMap;
uniform int uSphMode;
uniform float uSphStrength;`,
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
{
  vec2 sphUv = clamp(vNormal.xy * 0.5 + 0.5, vec2(0.0), vec2(1.0));
  vec4 sph = texture2D(uSphMap, vec2(sphUv.x, 1.0 - sphUv.y));
  if (uSphMode == 2 || uSphMode == 3) {
    diffuseColor.rgb += sph.rgb * (uSphMode == 3 ? sph.a : 1.0) * uSphStrength;
  } else if (uSphMode == 1) {
    diffuseColor.rgb *= mix(vec3(1.0), sph.rgb * 2.0, uSphStrength);
  }
}`,
            );
        };
        mat.customProgramCacheKey = () => `sph-${envMode}`;
        mat.needsUpdate = true;
      }
    }

    if (keepMap && m.textureIndex >= 0 && map) {
      const raw = data.textures[m.textureIndex];
      if (raw) {
        const path = texPathOf(raw);
        if (path) {
          if (!matsByPath.has(path)) matsByPath.set(path, []);
          matsByPath.get(path).push(mat);
        }
      }
    }
    mat.userData.mmd = { flag: m.flag, textureIndex: m.textureIndex };

    // 作者在本材质上指定的描边粗细/颜色（归一化后供「渲染调节」使用）
    const edgeSize = m.edgeSize ?? 0;
    if (edgeSize > 0) {
      mat.userData.mmdEdge = {
        size: edgeSize,
        norm: Math.max(0.25, Math.min(3, edgeSize / (edgeMedian || 1))),
        color: m.edgeColor ?? [0, 0, 0],
      };
    }

    // 描边只描"外轮廓"该有的部件：五官、头发、蕾丝这类透明/小件一律不描，
    // 否则外扩出来的背面会把眼睛、嘴、发丝糊成黑块。
    const NO_OUTLINE = /(发|髮|毛|眉|睫|瞳|目|眼|口|齿|歯|舌|泪|涙|耳|脸|顔)/;
    if (NO_OUTLINE.test(m.name)) {
      mat.userData.outlineParameters = {
        ...(mat.userData.outlineParameters || {}),
        visible: false,
      };
    }
    return mat;
  });

  // 按材质切分绘制组。mmd-parser 的 faceCount 是"三角形数"，索引数要 ×3
  let start = 0;
  data.materials.forEach((m, i) => {
    const count = m.faceCount * 3;
    if (count > 0) geometry.addGroup(start, count, i);
    start += count;
  });
  if (start !== data.index.length) {
    console.warn('[pmx] 材质面数与索引数不一致', { groups: start, indices: data.index.length });
  }

  // 调试开关：?noskin=1 直接按绑定姿势渲染，隔离"几何/材质"与"蒙皮/重定向"
  const noskin = params.get('noskin') === '1';

  const mesh = noskin ? new THREE.Mesh(geometry, materials) : new THREE.SkinnedMesh(geometry, materials);
  mesh.name = 'pmxMesh';
  mesh.castShadow = true;
  // MMD 的贴图自带明暗，再叠自阴影会出现"头发在脸上投一道黑影"的脏效果；
  // 只保留投到地面的影子，不接收阴影。
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;

  mesh.add(armature);
  // 先将骨骼世界矩阵就位，Skeleton 的逆绑定矩阵才是对的
  mesh.updateMatrixWorld(true);
  const skeleton = noskin ? null : new THREE.Skeleton(bones);
  if (!noskin) mesh.bind(skeleton);

  const root = new THREE.Group();
  root.name = 'pmxRoot';
  root.add(mesh);

  // ---------- 代理骨架 ----------
  const proxy = buildProxyRig();
  root.add(proxy.root);
  proxy.root.visible = false;

  // ---------- 骨骼映射 ----------
  const boneByName = new Map();
  data.bones.forEach((b, i) => {
    if (!boneByName.has(b.name)) boneByName.set(b.name, bones[i]);
  });

  // 统计每根骨骼"支配"的顶点数（取每个顶点权重最大的那根）。
  // 用来在候选名里挑真正驱动网格的那根 —— MMD 常见"D 变形骨"。
  const dominantCount = new Int32Array(bones.length);
  {
    const posAttr = geometry.attributes.position;
    const siArr = geometry.attributes.skinIndex.array;
    const swArr = geometry.attributes.skinWeight.array;
    const n = posAttr.count;
    for (let v = 0; v < n; v++) {
      let maxW = -1;
      let bi = -1;
      for (let k = 0; k < 4; k++) {
        const w = swArr[v * 4 + k];
        if (w > maxW) {
          maxW = w;
          bi = siArr[v * 4 + k];
        }
      }
      if (bi >= 0 && bi < dominantCount.length && maxW > 0.2) dominantCount[bi] += 1;
    }
  }
  const boneIndex = new Map();
  bones.forEach((bone, i) => boneIndex.set(bone, i));

  const map = {};
  const missing = [];
  const remapped = [];
  for (const [vrmName, candidates] of Object.entries(MMD_BONE_NAMES)) {
    let best = null;
    let bestScore = -1;
    let firstFound = null;
    for (const name of candidates) {
      const bone = boneByName.get(name);
      if (!bone) continue;
      if (!firstFound) firstFound = bone;
      const score = dominantCount[boneIndex.get(bone)] ?? 0;
      if (score > bestScore) {
        bestScore = score;
        best = bone;
      }
    }
    // 候选里没有任何一根支配顶点时，退回第一个存在的（至少姿势数据不会丢）
    const chosen = best && bestScore > 0 ? best : firstFound;
    if (chosen) {
      map[vrmName] = chosen;
      if (chosen !== firstFound) remapped.push(`${vrmName}→${chosen.name}(${bestScore})`);
    } else {
      missing.push(vrmName);
    }
  }
  console.log('[pmx] 骨骼映射', Object.keys(map).length, '/', Object.keys(MMD_BONE_NAMES).length, missing.length ? `缺 ${missing.join(',')}` : '');
  if (remapped.length) console.log('[pmx] 按权重改映射:', remapped.join(' '));

  // ---------- 链一致性校正 ----------
  // MMD 的"D 变形骨"里，同一段肢体常出现兄弟骨（例：左足D 下挂 左足02 和 左ひざD）。
  // 只按"权重最多"选，可能把大腿选成 左足02、小腿选成 左ひざD —— 这俩是兄弟、互不影响，
  // 结果就是大腿转一套、小腿转另一套，腿被撕成两截。
  // 所以这里从父到子检查：如果子骨骼不是当前骨骼的后代，就换成能涵盖它的那根候选骨。
  const isDescendantOf = (bone, ancestor) => {
    let node = bone ? bone.parent : null;
    while (node && node.isBone) {
      if (node === ancestor) return true;
      node = node.parent;
    }
    return false;
  };
  const chainFix = [];
  for (const vrmName of TOPO_ORDER) {
    const bone = map[vrmName];
    if (!bone) continue;
    const childSlots = (HIERARCHY[vrmName] || []).filter((c) => map[c]);
    if (!childSlots.length) continue;
    // 只对"真正有顶点权重"的子骨骼做约束，避免被空骨（如左つま先 0 顶点）带偏
    const weightedChildren = childSlots.filter((c) => (dominantCount[boneIndex.get(map[c])] ?? 0) > 0);
    if (!weightedChildren.length) continue;
    const broken = weightedChildren.some((c) => !isDescendantOf(map[c], bone));
    if (!broken) continue;

    const candidates = (MMD_BONE_NAMES[vrmName] || []).map((n) => boneByName.get(n)).filter(Boolean);
    const fix = candidates.find((cand) =>
      weightedChildren.every((c) => map[c] === cand || isDescendantOf(map[c], cand)),
    );
    if (fix && fix !== bone) {
      chainFix.push(`${vrmName}: ${bone.name}→${fix.name}`);
      map[vrmName] = fix;
    }
  }
  if (chainFix.length) console.log('[pmx] 链一致性校正:', chainFix.join(' '));

  // ---------- 绑定位姿校正 ----------
  root.updateMatrixWorld(true);
  const corrections = new Map();
  for (const name of TOPO_ORDER) {
    const bone = map[name];
    const canon = CANON_DIR[name];
    if (!bone || !canon) continue;
    if (!NEEDS_ALIGN.has(name)) {
      corrections.set(name, new THREE.Quaternion());
      continue;
    }
    // 取"这根骨骼在 rest 时的朝向"，必须用**同一条骨链上的子骨骼**。
    // 之前用映射表里的子骨骼，会取到另一条链上的骨（例：左足首D 配到 左つま先），
    // 方向完全不对，算出来的校正把脚扭成麻花。
    let child = null;
    // 1) 优先用真实的直属子骨骼（同链，最可靠）
    const directChild = (bone.children || []).find((c) => c && c.isBone);
    if (directChild) child = directChild;
    // 2) 退而求其次：映射到的子骨骼，但必须确实是它的后代
    if (!child) {
      const childName = (HIERARCHY[name] || []).find((n) => map[n] && isDescendantOf(map[n], bone));
      if (childName) child = map[childName];
    }
    if (!child) {
      corrections.set(name, new THREE.Quaternion());
      continue;
    }
    child.getWorldPosition(_v1);
    bone.getWorldPosition(_v2);
    const dir = _v1.sub(_v2);
    if (dir.lengthSq() < 1e-8) {
      corrections.set(name, new THREE.Quaternion());
      continue;
    }
    dir.normalize();
    const target = new THREE.Vector3(...canon).normalize();
    const angle = dir.angleTo(target);
    // 方向差太大说明这根骨骼的子骨骼不是"顺着骨骼长"的，别硬掰
    if (angle > (100 * Math.PI) / 180) {
      corrections.set(name, new THREE.Quaternion());
      continue;
    }
    corrections.set(name, new THREE.Quaternion().setFromUnitVectors(dir, target));
  }

  // ---------- 重定向 ----------
  const proxyNodes = proxy.nodes;
  const noRetarget = params.get('noretarget') === '1';

  // 姿势里的 hips 平移要同步到 MMD 骨骼。
  // ⚠️ 不能直接平移「下半身」：MMD 里 上半身 / 下半身 是兄弟节点（都挂在「腰」下），
  //    只动下半身会让腿下沉、躯干留在原地，中间被拉长成"非人形"。
  // 正确做法是平移所有映射骨骼的**最近共同祖先**（这里就是「腰」），整个人一起动。
  const mappedBones = Object.values(map).filter(Boolean);
  const ancestorOf = (bone) => {
    const chain = [];
    let node = bone;
    while (node && node.isBone) {
      chain.push(node);
      node = node.parent;
    }
    return chain; // 自己在前，根在后
  };
  const findCommonAncestor = (boneList) => {
    if (!boneList.length) return null;
    const chains = boneList.map(ancestorOf);
    const shortest = chains.reduce((a, b) => (a.length <= b.length ? a : b));
    for (const node of shortest) {
      if (chains.every((chain) => chain.includes(node))) return node;
    }
    return null;
  };
  const moverBone = findCommonAncestor(mappedBones);
  const moverRestLocal = moverBone ? moverBone.position.clone() : null;
  const hipsProxyBase = PROXY_OFFSETS.hips;
  if (moverBone) {
    console.log('[pmx] hips 平移作用在共同祖先:', moverBone.name, '（映射骨骼', mappedBones.length, '根）');
  }

  function applyHipsTranslation() {
    if (!moverBone || !moverRestLocal) return;
    const proxyHips = proxyNodes.get('hips');
    if (!proxyHips) return;
    moverBone.position.set(
      moverRestLocal.x + (proxyHips.position.x - hipsProxyBase[0]),
      moverRestLocal.y + (proxyHips.position.y - hipsProxyBase[1]),
      moverRestLocal.z + (proxyHips.position.z - hipsProxyBase[2]),
    );
    moverBone.updateMatrixWorld(false, false);
  }

  function retarget() {
    if (noskin || noRetarget) return;
    applyHipsTranslation();
    for (const name of TOPO_ORDER) {
      const target = map[name];
      const pNode = proxyNodes.get(name);
      if (!target || !pNode) continue;

      pNode.getWorldQuaternion(_q1); // 代理世界朝向 = 姿势增量
      const corr = corrections.get(name);
      if (corr) _q1.multiply(corr); // 先转到标准朝向，再叠姿势

      const parentObj = target.parent && target.parent.isBone ? target.parent : null;
      if (parentObj) {
        parentObj.getWorldQuaternion(_q2);
        _q2.invert();
        _q1.premultiply(_q2);
      }
      target.quaternion.copy(_q1);
      target.updateMatrixWorld(false, false);
    }
  }

  const humanoid = {
    autoUpdateHumanBones: true,
    getNormalizedBoneNode: (name) => proxyNodes.get(name) || null,
  };

  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(mesh);

  // 骨骼到"鞋底"的偏移：接地校正如果直接把脚踝/脚趾骨骼放到 y=0，
  // 鞋底会低十几厘米埋进地面。这里在绑定姿势下量一次，之后接地按它补偿。
  // 注意：不能用 Box3.setFromObject(mesh) —— 对 SkinnedMesh 它给的不是顶点包围盒。
  let soleOffset = 0.03;
  let toeY = NaN;
  let minVertexY = NaN;
  {
    const posAttr = geometry.attributes.position;
    minVertexY = Infinity;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      if (y < minVertexY) minVertexY = y;
    }
    toeY = Infinity;
    for (const name of ['leftToes', 'rightToes', 'leftFoot', 'rightFoot']) {
      const bone = map[name];
      if (!bone) continue;
      bone.getWorldPosition(_v1);
      toeY = Math.min(toeY, _v1.y);
    }
    if (Number.isFinite(toeY) && Number.isFinite(minVertexY)) {
      soleOffset = Math.max(0.005, Math.min(0.3, toeY - minVertexY));
    }
  }

  console.log('[pmx] 尺寸', {
    scale: Number(scale.toFixed(4)),
    height: Number((bbox.max.y - bbox.min.y).toFixed(2)),
    minY: Number(bbox.min.y.toFixed(2)),
    maxY: Number(bbox.max.y.toFixed(2)),
    badSkinIndex: badIndex,
    soleOffset: Number(soleOffset.toFixed(4)),
    toeY: Number(toeY.toFixed(4)),
    minVertexY: Number(minVertexY.toFixed(4)),
  });

  // 调试：检查"蒙皮在绑定姿势下是否等于单位变换"
  window.__pmxDebug = () => {
    if (!skeleton) return { noskin: true };
    const devs = [];
    for (let i = 0; i < bones.length; i += 37) {
      const m = new THREE.Matrix4().multiplyMatrices(bones[i].matrixWorld, skeleton.boneInverses[i]);
      const e = m.elements;
      const dev =
        Math.abs(e[12]) + Math.abs(e[13]) + Math.abs(e[14]) +
        Math.abs(e[0] - 1) + Math.abs(e[5] - 1) + Math.abs(e[10] - 1);
      devs.push({ name: bones[i].name, dev: Number(dev.toFixed(3)) });
    }
    const sorted = [...devs].sort((a, b) => b.dev - a.dev);
    return {
      boneCount: bones.length,
      worst: sorted.slice(0, 6),
      goodCount: sorted.filter((d) => d.dev < 0.01).length,
      total: sorted.length,
    };
  };

  // 每个顶点的主权重骨骼 + 脚部骨骼集合。
  // 接地只认脚：披风/裙摆下摆常常比鞋底更低，按"全模型最低点"接地会把衣服贴地、脚沉下去。
  const vertexDominant = new Uint16Array(geometry.attributes.position.count);
  {
    const siArr = geometry.attributes.skinIndex.array;
    const swArr = geometry.attributes.skinWeight.array;
    for (let v = 0; v < vertexDominant.length; v++) {
      let mw = -1;
      let bi = 0;
      for (let k = 0; k < 4; k++) {
        const w = swArr[v * 4 + k];
        if (w > mw) {
          mw = w;
          bi = siArr[v * 4 + k];
        }
      }
      vertexDominant[v] = bi;
    }
  }
  const footBones = new Set();
  // 坐姿的接触点是臀部而不是脚，所以把 hips 也纳入接地参考
  for (const slot of ['leftFoot', 'rightFoot', 'leftToes', 'rightToes']) {
    const b = map[slot];
    if (!b) continue;
    b.traverse((o) => {
      if (o.isBone) {
        const idx = boneIndex.get(o);
        if (idx !== undefined) footBones.add(idx);
      }
    });
  }
  let footVertexCount = 0;
  for (let v = 0; v < vertexDominant.length; v++) if (footBones.has(vertexDominant[v])) footVertexCount += 1;
  console.log('[pmx] 脚部顶点', footVertexCount, '/', vertexDominant.length, '脚骨', footBones.size);

  // 蒙皮后的最低点（世界 Y）。接地校正直接用它，不依赖脚骨高度。
  // 只在换姿势时调用一次，46k 顶点约几毫秒。
  const _bm = [];
  const getLowestWorldY = () => {
    if (!skeleton) return null;
    root.updateMatrixWorld(true);
    const posArr = geometry.attributes.position.array;
    const siArr = geometry.attributes.skinIndex.array;
    const swArr = geometry.attributes.skinWeight.array;
    const n = skeleton.bones.length;
    if (_bm.length !== n) {
      _bm.length = 0;
      for (let i = 0; i < n; i++) _bm.push(new THREE.Matrix4());
    }
    for (let i = 0; i < n; i++) {
      _bm[i].multiplyMatrices(skeleton.bones[i].matrixWorld, skeleton.boneInverses[i]);
    }
    const bind = mesh.bindMatrix.elements;
    const bindInv = mesh.bindMatrixInverse.elements;
    const mw = mesh.matrixWorld.elements;
    const useFeet = footVertexCount > 0;
    let min = Infinity;
    const count = posArr.length / 3;
    for (let v = 0; v < count; v++) {
      // 只算脚部顶点（没有脚部顶点时退回全模型）
      if (useFeet && !footBones.has(vertexDominant[v])) continue;

      let x = posArr[v * 3];
      let y = posArr[v * 3 + 1];
      let z = posArr[v * 3 + 2];
      const bx = bind[0] * x + bind[4] * y + bind[8] * z + bind[12];
      const by = bind[1] * x + bind[5] * y + bind[9] * z + bind[13];
      const bz = bind[2] * x + bind[6] * y + bind[10] * z + bind[14];
      x = bx;
      y = by;
      z = bz;

      let sx = 0;
      let sy = 0;
      let sz = 0;
      let wsum = 0;
      for (let k = 0; k < 4; k++) {
        const w = swArr[v * 4 + k];
        if (w === 0) continue;
        const bi = siArr[v * 4 + k];
        const m = _bm[bi];
        if (!m) continue;
        const e = m.elements;
        sx += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
        sy += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
        sz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
        wsum += w;
      }
      if (wsum > 0) {
        sx /= wsum;
        sy /= wsum;
        sz /= wsum;
      }
      // bindMatrixInverse 之后得到的是**网格局部坐标**（和顶点着色器一致：
      // 着色器最后还要乘一次 modelViewMatrix）。要拿到世界坐标必须再乘 mesh.matrixWorld，
      // 否则根节点的平移对结果完全没有影响（接地会永远"悬空"）。
      const lx = bindInv[0] * sx + bindInv[4] * sy + bindInv[8] * sz + bindInv[12];
      const ly = bindInv[1] * sx + bindInv[5] * sy + bindInv[9] * sz + bindInv[13];
      const lz = bindInv[2] * sx + bindInv[6] * sy + bindInv[10] * sz + bindInv[14];
      const wy = mw[1] * lx + mw[5] * ly + mw[9] * lz + mw[13];
      if (wy < min) min = wy;
    }
    return Number.isFinite(min) ? min : null;
  };

  return {
    kind: 'pmx',
    label: url.split('/').pop(),
    root,
    humanoid,
    mesh,
    skeleton,
    scale,
    /** 接地校正用：直接把最低顶点贴到地面 */
    groundClearance: 0.004,
    getLowestWorldY,
    update() {
      retarget();
      root.updateMatrixWorld(true);
    },
    retarget,
    /** 渲染调节面板用：改明暗下限（1 = 纯平，0.55 = 强对比） */
    setShadingFloor(v) {
      setShadingFloor(v);
    },
    getShadingFloor: () => shadingFloor,
    getBoneWorldPosition(name, out = new THREE.Vector3()) {
      const bone = map[name];
      if (!bone) return null;
      return bone.getWorldPosition(out);
    },
    dispose() {
      geometry.dispose();
      for (const m of materials) {
        m.map?.dispose();
        m.dispose();
      }
      skeleton?.dispose?.();
    },
  };
}








