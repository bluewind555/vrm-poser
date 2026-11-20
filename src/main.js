import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

import { createMannequin } from './mannequin.js';
import { loadPMX } from './pmx-loader.js';
import { createTuning } from './tuning.js';
import { createUI } from './ui.js';
import { landmarksToPose, fuseViews } from './img2pose.js';
import { applyPose, capturePose, mirrorPose } from './pose.js';
import { createGallery } from './gallery.js';
import { createModelLibrary } from './modellib.js';
import { createCatalog } from './catalog.js';
import { createCatalogImportUI } from './catalogImportUI.js';
import { buildRecord, saveLocalModel, getLocalModel, deleteLocalModel, listLocalModels } from './modelStore.js';
import { canSaveToDisk, saveFilesToDisk } from './diskSaver.js';
import { deleteDiskModel } from './diskMeta.js';
import { createModelMetaUI } from './modelMetaUI.js';
import { createExpressionPanel } from './expressions.js';
import { createExportUI } from './exportUI.js';
import { createMotion } from './motions.js';
import { parseVmdBuffer } from './vmd.js';
import { setOverride, clearOverride, getOverride, getOverrideStamp } from './poseStore.js';

const APP_VERSION = 'v46 · 2026-11-20';
const canvas = document.querySelector('#view');

// ---------- 渲染器 / 场景 ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171d);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0.9, 1.35, 3.4);

// 描边：OutlineEffect 走"反面外扩"，支持蒙皮（发丝/蕾丝这类透明材质在 loader 里关掉）。
// 具体粗细/开关由「渲染调节」面板在每帧的 userData 里驱动，这里只建一次。
const query = new URLSearchParams(location.search);
const outlineEffect = new OutlineEffect(renderer, {
  defaultThickness: 0.0035,
  defaultColor: [0.02, 0.02, 0.03],
  defaultAlpha: 1,
});
outlineEffect.setSize(window.innerWidth, window.innerHeight);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.0, 0);
controls.minDistance = 0.35;
controls.maxDistance = 12;
// 允许 360° 观察：一直转到几乎正下方（地面会在相机低于地面时自动隐藏）
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI * 0.995;

// ---------- 光照 / 地面 ----------
const hemi = new THREE.HemisphereLight(0xc8dbff, 0x2a2f3a, 1.1);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(2.4, 4.2, 2.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 12;
key.shadow.camera.left = -2.5;
key.shadow.camera.right = 2.5;
key.shadow.camera.top = 2.5;
key.shadow.camera.bottom = -2.5;
key.shadow.bias = -0.0008;
scene.add(key);

const rim = new THREE.DirectionalLight(0x8fb6ff, 0.9);
rim.position.set(-3, 2.2, -3.2);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(9, 64),
  new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.95, metalness: 0.0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.material.userData.outlineParameters = { visible: false };
scene.add(ground);

const grid = new THREE.GridHelper(12, 24, 0x39414f, 0x232833);
grid.position.y = 0.001;
grid.material.transparent = true;
grid.material.opacity = 0.65;
grid.material.userData.outlineParameters = { visible: false };
scene.add(grid);

// ---------- 接触阴影 ----------
// 方向光的投影只有轮廓、脚底还是"飘"的。脚下垫一张径向渐变的软阴影，
// 位置跟着双脚中点走、大小按两脚间距，人物立刻"踩得住"地面。
const contactShadow = (() => {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.02, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0, 'rgba(0,0,0,0.95)');
  grad.addColorStop(0.32, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.62, 'rgba(0,0,0,0.24)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.85,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.004;
  mesh.renderOrder = 2;
  mesh.material.userData.outlineParameters = { visible: false };
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
})();

const _footL = new THREE.Vector3();
const _footR = new THREE.Vector3();

function updateContactShadow() {
  if (!avatar || !tuning) {
    contactShadow.visible = false;
    return;
  }
  // 相机跑到地面以下时，地面都藏起来了，阴影也别画
  if (camera.position.y < 0.03) {
    contactShadow.visible = false;
    return;
  }
  const opacity = tuning.state.contact ?? 0.85;
  if (opacity <= 0.02) {
    contactShadow.visible = false;
    return;
  }

  const footWorld = (name, out) => {
    if (avatar.getBoneWorldPosition) return avatar.getBoneWorldPosition(name, out);
    const node = avatar.humanoid?.getNormalizedBoneNode?.(name);
    return node ? node.getWorldPosition(out) : null;
  };
  const l = footWorld('leftFoot', _footL);
  const r = footWorld('rightFoot', _footR);

  let cx;
  let cz;
  let width;
  if (l && r) {
    cx = (l.x + r.x) / 2;
    cz = (l.z + r.z) / 2;
    width = Math.max(0.55, l.distanceTo(r) * 2.0);
  } else {
    cx = avatar.root.position.x;
    cz = avatar.root.position.z;
    width = 0.6;
  }

  contactShadow.visible = true;
  contactShadow.position.set(cx, 0.004, cz);
  contactShadow.scale.set(width, width, 1);
  contactShadow.material.opacity = opacity;
}

// ---------- 模型管理 ----------
const gltfLoader = new GLTFLoader();
gltfLoader.register((parser) => new VRMLoaderPlugin(parser));

let avatar = null;
let tuning = null; // 渲染调节面板，稍后创建
let objectUrl = null;

/** 收集场景里当前模型的所有材质（描边参数要逐材质写 userData） */
function collectAvatarMaterials() {
  const mats = new Set();
  if (!avatar) return mats;
  avatar.root.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) mats.add(m);
  });
  return mats;
}

/** 把「渲染调节」的状态落到灯光 / 描边 / 材质上 */
function applyTuning(s) {
  hemi.intensity = s.ambient;
  key.intensity = s.key;
  rim.intensity = s.rim;

  // PMX 的明暗下限（VRM/人偶没有这个接口，跳过）
  avatar?.setShadingFloor?.(s.shading);

  for (const m of collectAvatarMaterials()) {
    const prev = m.userData.outlineParameters || {};
    // 作者在 PMX 里给的描边粗细（相对中位数归一化）：头发 0.25x、衣装 1x 之类
    const edgeNorm = m.userData.mmdEdge?.norm ?? 1;
    m.userData.outlineParameters = {
      ...prev,
      thickness: s.outline * edgeNorm,
      // 原本就排除描边的（五官/发丝/透明材质）保持排除
      visible: s.outlineOn && prev.visible !== false,
    };
    // 球面高光强度：直接改注入的 uniform，不用重建材质
    const sph = m.userData.sph;
    if (sph) sph.uSphStrength.value = s.sph ?? 0.55;
  }
  const mats = [...collectAvatarMaterials()];
  if (mats[0]) {
    console.log('[tune] applied', {
      materials: mats.length,
      thickness: s.outline,
      first: mats[0].userData.outlineParameters,
    });
  }
}

function disposeAvatar(a) {
  if (!a) return;
  scene.remove(a.root);
  try {
    a.dispose?.();
  } catch (err) {
    console.warn('[pose] dispose failed', err);
  }
}

function boneWorldPoints(a) {
  const pts = [];
  const v = new THREE.Vector3();
  for (const name of ['head', 'hips', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot']) {
    const node = a.humanoid?.getNormalizedBoneNode?.(name);
    if (!node) continue;
    node.getWorldPosition(v);
    pts.push(v.clone());
  }
  return pts;
}

/** 按骨骼位置取景：比 Box3 更可靠（SkinnedMesh 的包围盒不是蒙皮后的形状） */
export function frameAvatar(a = avatar) {
  if (!a) return;
  a.root.updateMatrixWorld(true);
  let pts = boneWorldPoints(a);
  if (!pts.length) {
    const box = new THREE.Box3().setFromObject(a.root);
    if (box.isEmpty()) return;
    pts = [box.min, box.max];
  }
  const box = new THREE.Box3().setFromPoints(pts);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const height = Math.max(size.y, 0.6);

  controls.target.set(center.x, center.y + height * 0.04, center.z);
  const dist = height * 2.55;
  camera.position.set(center.x + dist * 0.18, center.y + height * 0.22, center.z + dist * 0.95);
  camera.near = Math.max(0.01, dist / 100);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

/** 视角预设：正面 / 侧面 / 背面 / 俯视 / 仰视 / 特写 */
export function setViewPreset(name) {
  const a = avatar;
  if (!a) return false;
  a.root.updateMatrixWorld(true);
  const pts = boneWorldPoints(a);
  const box = pts.length ? new THREE.Box3().setFromPoints(pts) : new THREE.Box3().setFromObject(a.root);
  if (box.isEmpty()) return false;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, 0.6);

  const dirs = {
    front: new THREE.Vector3(0, 0, 1),
    side: new THREE.Vector3(1, 0.05, 0),
    back: new THREE.Vector3(0, 0.05, -1),
    // 正俯视/正仰视要和 up 轴错开一点，否则 lookAt 退化
    top: new THREE.Vector3(0, 1, 0.08),
    bottom: new THREE.Vector3(0, -1, 0.08),
    closeup: new THREE.Vector3(0.18, 0.08, 1),
  };
  const dir = (dirs[name] ?? dirs.front).clone().normalize();

  let target = center.clone();
  target.y = center.y + h * 0.02;
  let dist = h * 2.2;

  if (name === 'top' || name === 'bottom') dist = h * 1.9;
  if (name === 'closeup') {
    const head = a.humanoid?.getNormalizedBoneNode?.('head');
    // head 骨骼在颈根/下颌附近：往上一丁点命中面部，距离按"头肩特写"取
    if (head) target = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, h * 0.03, 0));
    dist = h * 1.15;
  }

  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, dist / 100);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
  return true;
}

function setAvatar(next, statusText) {
  const prev = avatar;
  avatar = next;
  if (prev) disposeAvatar(prev);
  if (next) {
    scene.add(next.root);
    frameAvatar(next);
  }
  ui.onAvatarChange(next, statusText);
  expressionPanel.attach(next);
  tuning?.apply(); // 换模型后把描边/明暗重新套一遍
  return next;
}

async function loadVRM(url, label = 'VRM 模型') {
  console.time('[pose] loadAsync');
  const gltf = await gltfLoader.loadAsync(url);
  console.timeEnd('[pose] loadAsync');

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('这不是 VRM：gltf.userData.vrm 为空（GLB 需含 VRM 扩展）');
  const boneNames = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerLeg', 'leftToes'];
  console.log(
    '[pose] meta:',
    vrm.meta?.metaVersion,
    '| normalized bones ok:',
    boneNames.filter((n) => !!vrm.humanoid.getNormalizedBoneNode(n)).length,
  );

  // VRM 0.x 面向 -Z，必须转到 +Z
  VRMUtils.rotateVRM0(vrm);

  // 合并同名骨骼节点，减少每帧的 matrixWorld 开销（个别带约束的模型会失败，忽略即可）
  try {
    VRMUtils.combineSkeletons?.(gltf.scene);
  } catch (err) {
    console.warn('[pose] combineSkeletons skipped:', err);
  }

  // 蒙皮网格不能靠包围盒剔除，姿势一改就可能被裁掉
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
  });

  return {
    kind: 'vrm',
    label,
    root: vrm.scene,
    vrm,
    humanoid: vrm.humanoid,
    update: (dt) => vrm.update(dt),
    dispose: () => VRMUtils.deepDispose(vrm.scene),
  };
}

async function loadFromUrl(url, label) {
  ui.setStatus(`加载中：${label}`);
  startProgressWatch();
  try {
    const clean = url.split('?')[0].toLowerCase();
    let a;
    if (clean.endsWith('.pmx')) {
      const basePath = url.slice(0, url.lastIndexOf('/') + 1);
      a = await loadPMX(url, basePath);
    } else {
      a = await loadVRM(url, label);
    }
    setAvatar(a);
    hideProgress();
    ui.setStatus(
      a.kind === 'pmx'
        ? `已加载 ${label}（PMX · 已重定向到标准人形骨骼）`
        : `已加载 ${label} · VRM ${a.vrm.meta?.metaVersion ?? '?'} 规范`,
    );
    return a;
  } catch (err) {
    console.error(err);
    hideProgress();
    ui.setStatus(`加载失败：${err.message}`, 'error');
    return null;
  }
}

function useMannequin() {
  const m = createMannequin();
  setAvatar(m);
  ui.setStatus('当前是程序化人偶，用于验证姿势管线');
  return m;
}

// ---------- 本地文件夹载入（PMX + 贴图） ----------
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/**
 * 从一组本地文件里找 .pmx，并用同一批文件解析它的贴图（blob URL）。
 * 这样用户只要把解压后的整个文件夹选进来/拖进来，贴图就一起带上了。
 */
async function loadFromFiles(files) {
  const list = [...files];
  let savedOk = null;
  if (!list.length) return;

  const pmxFiles = list.filter((f) => f.name.toLowerCase().endsWith('.pmx'));
  if (!pmxFiles.length) {
    // 没有 pmx：按普通单文件走（VRM / GLB）
    const vrm = list.find((f) => /\.(vrm|glb)$/i.test(f.name));
    if (vrm) return ui.handleFile(vrm);
    ui.setStatus('这个文件夹里没找到 .pmx / .vrm / .glb', 'error');
    return;
  }
  // 多个 pmx 时取体积最大的（通常是本体，其它是武器等配件）
  pmxFiles.sort((a, b) => b.size - a.size);
  const pmx = pmxFiles[0];

  const relOf = (f) => normPath(f.__relPath || f.webkitRelativePath || f.name);
  const fileMap = new Map();
  for (const f of list) {
    const k = relOf(f);
    if (k) fileMap.set(k, f);
  }

  const pmxRel = relOf(pmx);
  const pmxDir = pmxRel.includes('/') ? pmxRel.slice(0, pmxRel.lastIndexOf('/') + 1) : '';
  const urlCache = new Map();
  const resolveTexture = (rel) => {
    const want = normPath(pmxDir + rel);
    let file = fileMap.get(want);
    if (!file) {
      // 退化：只按文件名匹配（不同模型的贴图目录名常常和 pmx 里写的不完全一致）
      const base = want.split('/').pop();
      for (const [k, f] of fileMap) {
        if (k === base || k.endsWith('/' + base)) {
          file = f;
          break;
        }
      }
    }
    if (!file) return null;
    if (!urlCache.has(file)) urlCache.set(file, URL.createObjectURL(file));
    return urlCache.get(file);
  };

  ui.setStatus(`载入中：${pmx.name}（文件夹 ${list.length} 个文件）`);
  const pmxUrl = URL.createObjectURL(pmx);
  try {
    const a = await loadPMX(pmxUrl, resolveTexture);
    setAvatar(a);
    const texStats = window.__pmxTextures;
    const texInfo = texStats ? `贴图 ${texStats.total - texStats.failed}/${texStats.total}` : '';
    ui.setStatus(`已加载 ${pmx.name} · ${texInfo}`);

    // 优先写到磁盘（npm run dev 带本地服务），失败再退回浏览器收藏库
    const canDisk = await canSaveToDisk();
    if (canDisk) {
      const disk = await saveFilesToDisk(list, {
        onProgress: (done, total) => ui.setStatus(`保存到磁盘… ${done}/${total}`),
      });
      if (disk.ok) {
        savedOk = { id: disk.modelDir, name: disk.modelDir, game: '' };
        ui.setStatus(
          `已保存到 public/models/${disk.modelDir}/（${disk.saved} 个文件${disk.failed ? `，${disk.failed} 个失败` : ''}）`,
        );
        modelLibrary.reload();
        catalog.reload();
        // 自动猜的游戏名多半是"未分类"，这里让人改一下，顺便把 model.json 写了
        // 用 disk.modelDir（保留原始大小写）；pmxDir 是归一化过的全小写路径
        const folder = disk.modelDir;
        const guessedChar = folder.replace(/[_\-\s]*by[_\-\s].*$/i, '').replace(/^【[^】]*】/, '').trim() || folder;
        modelMeta.open({
          modelDir: disk.modelDir,
          character: guessedChar,
          game: guessGameFromText(`${folder} ${pmx.name}`),
          outfit: '默认',
          license: '禁止二次配布 / 见原页面说明',
          tags: [],
        });
      }
    }
    if (!savedOk) {
      savedOk = await persistUploadedModel(list, pmx, pmxDir);
      if (savedOk) {
        ui.setStatus(`已加载并收藏到浏览器：${savedOk.name}（${texInfo}）`);
        modelLibrary.reload();
        catalog.reload();
      }
    }
  } catch (err) {
    console.error(err);
    ui.setStatus(`加载失败：${err.message}`, 'error');
  }
  return savedOk;
}

/** 把上传的模型存进 IndexedDB，返回入库后的元数据 */
async function persistUploadedModel(list, pmx, pmxDir) {
  try {
    const folder = pmxDir.split('/').filter(Boolean).pop() ?? pmx.name.replace(/\.pmx$/i, '');
    const character = folder.replace(/[_\-\s]*by[_\-\s].*$/i, '').replace(/^【[^】]*】/, '').trim() || folder;
    const game = guessGameFromText(`${folder} ${pmx.name}`);
    const id = `local-${slug(`${game}-${character}`)}`;
    const rec = buildRecord(list, {
      id,
      meta: {
        game,
        character,
        outfit: '默认',
        name: character,
        source: '本地上传',
        license: '',
        tags: ['本地收藏'],
        savedAt: new Date().toISOString(),
      },
    });
    if (!rec) return null;
    const ok = await saveLocalModel(rec);
    if (!ok) return null;
    return { id, name: character, game, ...rec.meta };
  } catch (err) {
    console.warn('[modellib] 收藏失败', err);
    return null;
  }
}

/** 从 IndexedDB 收藏库里加载（刷新后也能用） */
async function loadLocalModel(model) {
  const rec = await getLocalModel(model.id);
  if (!rec?.files?.length) {
    ui.setStatus('本地收藏读取失败，可能已被删除', 'error');
    return null;
  }
  const relOf = (f) => String(f.path).replace(/\\/g, '/');
  const fileMap = new Map(rec.files.map((f) => [relOf(f).toLowerCase(), f.blob]));
  const mainPath = rec.meta?.mainPath ?? relOf(rec.files.find((f) => /\.pmx$/i.test(f.path)) ?? rec.files[0]);
  const mainBlob = fileMap.get(mainPath.toLowerCase());
  if (!mainBlob) {
    ui.setStatus('收藏里找不到主模型文件', 'error');
    return null;
  }
  const dir = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/') + 1) : '';
  const urlCache = new Map();
  const resolveTexture = (rel) => {
    const want = `${dir}${rel}`.toLowerCase().replace(/^\.\//, '');
    let blob = fileMap.get(want);
    if (!blob) {
      const base = want.split('/').pop();
      for (const [k, b] of fileMap) {
        if (k === base || k.endsWith('/' + base)) {
          blob = b;
          break;
        }
      }
    }
    if (!blob) return null;
    if (!urlCache.has(blob)) urlCache.set(blob, URL.createObjectURL(blob));
    return urlCache.get(blob);
  };

  try {
    const a = await loadPMX(URL.createObjectURL(mainBlob), resolveTexture);
    setAvatar(a);
    const texStats = window.__pmxTextures;
    const texInfo = texStats ? `贴图 ${texStats.total - texStats.failed}/${texStats.total}` : '';
    ui.setStatus(`已加载 ${model.name}（本地收藏 · ${texInfo}）`);
    return a;
  } catch (err) {
    console.error(err);
    ui.setStatus(`加载失败：${err.message}`, 'error');
    return null;
  }
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function guessGameFromText(text) {
  const rules = [
    [/原神|genshin/i, '原神'],
    [/绝区零|zenless|zzz/i, '绝区零'],
    [/星穹|star.?rail|hsr/i, '崩坏：星穹铁道'],
    [/崩坏3|honkai.?3/i, '崩坏3'],
    [/鸣潮|wuthering|wuwa/i, '鸣潮'],
    [/异环|neverness|nte/i, '异环'],
    [/蓝色星原/i, '蓝色星原'],
  ];
  for (const [re, name] of rules) if (re.test(text)) return name;
  return '未分类';
}

/** 拖拽进来的可能是文件夹，递归收集里面的文件 */
async function collectDroppedFiles(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.length) return [...(dataTransfer.files || [])];

  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      try {
        file.__relPath = prefix + file.name;
      } catch {
        /* File 只读属性写不进去就算了 */
      }
      out.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const readAll = () =>
        new Promise((res, rej) => {
          const acc = [];
          const next = () =>
            reader.readEntries((batch) => {
              if (!batch.length) return res(acc);
              acc.push(...batch);
              next();
            }, rej);
          next();
        });
      const children = await readAll();
      for (const child of children) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

// ---------- UI ----------
document.getElementById('app-version').textContent = APP_VERSION;
const ui = createUI({
  getAvatar: () => avatar,
  onBeforePose: () => stopMotion(),
  // 应用姿势后恢复它存的表情
  onAfterPose: (pose) => {
    const expr = pose?.meta?.expression;
    if (expr) expressionPanel.setWeights(expr);
    if (pose?.meta?.motion) restoreMotion(pose.meta.motion);
  },
  // 保存姿势时把当前表情一起写进去
  onCaptureMeta: () => {
    const meta = {};
    const w = expressionPanel.getWeights();
    if (Object.keys(w).length) meta.expression = w;
    if (currentMotion?.motionId) {
      meta.motion = {
        kind: currentMotion.motionKind,
        id: currentMotion.motionId,
        name: currentMotion.name,
        speed: currentMotion.speed,
      };
    }
    return meta;
  },
  onLoadFile: async (file) => {
    if (file.name.toLowerCase().endsWith('.pmx')) {
      ui.setStatus('PMX 需要连贴图一起：请用「载入文件夹」选择解压后的整个目录', 'error');
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const a = await loadFromUrl(objectUrl, file.name);
    if (!a) ui.setStatus(`无法加载 ${file.name}`, 'error');
  },
  onLoadFiles: (files) => loadFromFiles(files),
  onPoseImages: async (files) => {
    const views = [];
    for (const file of files) {
      try {
        const { estimatePoseFromImage } = await import('./imagepose.js');
      const est = await estimatePoseFromImage(file);
        if (est) views.push({ name: file.name, world: est.world, ms: est.ms });
        else console.warn('[img2pose] 未检出人:', file.name);
      } catch (err) {
        console.warn('[img2pose] 估计失败:', file.name, err.message);
      }
    }
    if (!views.length) return false;
    const fused = fuseViews(views);
    const pose = landmarksToPose(avatar, fused);
    if (!pose) return false;
    ui.applyPoseData(pose);
    const low = Object.values(pose.meta?.confidence ?? {}).filter((v) => v < 0.8).length;
    ui.setStatus(
      `已从 ${views.length}/${files.length} 张图生成姿势${views.length > 1 ? '（多视图融合）' : ''}，${low} 个关节置信度偏低`,
    );
    return true;
  },
  onUseMannequin: () => useMannequin(),
  onFrame: () => frameAvatar(),
});

// ---------- 姿势库画廊 ----------
// 缩略图用当前模型离屏渲染（不是第三方图片），所以换模型/改渲染设置都会自动重烤。
const THUMB_W = 384;
const THUMB_H = 512;
let thumbTarget = null;
const thumbCamera = new THREE.PerspectiveCamera(30, THUMB_W / THUMB_H, 0.05, 60);

/**
 * 把当前场景离屏渲染成一张竖版透明底 PNG（角色卡 / 姿势卡共用）。
 * 注意：会临时把 scene.background 置空，调用方负责在 finally 里还原。
 */
function renderPortraitToDataURL(target = avatar) {
  if (!target) return null;
  const pts = boneWorldPoints(target);
  const box = new THREE.Box3().setFromPoints(pts);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, 0.6);
  thumbCamera.position.set(center.x + h * 0.32, center.y + h * 0.08, center.z + h * 2.0);
  thumbCamera.lookAt(center.x, center.y, center.z);

  if (!thumbTarget) {
    thumbTarget = new THREE.WebGLRenderTarget(THUMB_W, THUMB_H, { format: THREE.RGBAFormat });
  }
  const savedBackground = scene.background;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  let buf;
  try {
    scene.background = null; // 透明底，否则卡片里是深色方块
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(thumbTarget);
    renderer.clear();
    outlineEffect.render(scene, thumbCamera);
    buf = new Uint8Array(THUMB_W * THUMB_H * 4);
    renderer.readRenderTargetPixels(thumbTarget, 0, 0, THUMB_W, THUMB_H, buf);
  } finally {
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.background = savedBackground;
  }

  // 上下翻转（WebGL 原点在左下）
  const cv = document.createElement('canvas');
  cv.width = THUMB_W;
  cv.height = THUMB_H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(THUMB_W, THUMB_H);
  const rowBytes = THUMB_W * 4;
  for (let y = 0; y < THUMB_H; y++) {
    const src = (THUMB_H - 1 - y) * rowBytes;
    img.data.set(buf.subarray(src, src + rowBytes), y * rowBytes);
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

async function bakeThumb(poseEntry) {
  if (!avatar) return null;
  let res;
  try {
    res = await fetch(poseEntry.file);
    if (!res.ok) return null;
  } catch {
    return null;
  }
  const pose = await res.json();
  const savedPose = capturePose(avatar.humanoid, 'tmp');
  const savedExpr = expressionPanel.getWeights();
  const savedRootY = avatar.root.position.y;

  try {
    applyPose(avatar.humanoid, pose);
    // 缩略图也体现表情，否则画廊里全是扑克脸
    if (pose.meta?.expression) expressionPanel.setWeights(pose.meta.expression);
    avatar.retarget?.();
    avatar.root.updateMatrixWorld(true);
    return renderPortraitToDataURL();
  } catch (err) {
    console.warn('[gallery] 缩略图烘焙失败', err);
    return null;
  } finally {
    // 无论成功失败都还原用户当前姿势和表情
    expressionPanel.setWeights(savedExpr);
    applyPose(avatar.humanoid, savedPose);
    avatar.retarget?.();
    avatar.root.position.y = savedRootY;
    avatar.root.updateMatrixWorld(true);
  }
}

// ---------- 加载进度 ----------
// PMX 贴图是异步解码的，loader 里有 window.__pmxTextures 计数，这里轮询它显示进度；
// 否则"浔"这种 19 秒的模型只有一个静态的"加载中…"，看着像卡死。
const loadProgressEl = document.getElementById('load-progress');
const loadProgressBar = document.getElementById('load-progress-bar');
const loadProgressText = document.getElementById('load-progress-text');
let progressTimer = null;

function showProgress(text, ratio) {
  if (!loadProgressEl) return;
  loadProgressEl.hidden = false;
  if (loadProgressText) loadProgressText.textContent = text;
  if (loadProgressBar) loadProgressBar.style.width = ratio == null ? '12%' : Math.round(ratio * 100) + '%';
}

function hideProgress() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
  if (loadProgressEl) loadProgressEl.hidden = true;
  if (loadProgressBar) loadProgressBar.style.width = '0%';
}

function startProgressWatch() {
  hideProgress();
  showProgress('解析模型…', 0.08);
  progressTimer = setInterval(() => {
    const s = window.__pmxTextures;
    if (!s || !s.total) return;
    const failed = s.failed ? '（失败 ' + s.failed + '）' : '';
    showProgress('贴图 ' + s.loaded + '/' + s.total + failed, 0.15 + 0.8 * (s.loaded / s.total));
  }, 150);
}

// ---------- 批量烤角色卡缩略图 ----------
// 每个模型都要完整加载一次（5~19 秒），所以：串行、只在角色库打开时跑、可随时中断。
// 为了不打断用户当前看的模型，临时模型加进场景渲染一次就拆掉，当前 avatar 只是临时隐藏。
let libraryBake = { running: false, done: 0, total: 0, cancel: false };

async function loadSilentModel(model) {
  if (model.source === 'local') {
    const rec = await getLocalModel(model.id);
    if (!rec?.files?.length) return null;
    const fileMap = new Map(rec.files.map((f) => [String(f.path).replace(/\\/g, '/').toLowerCase(), f.blob]));
    const mainPath = rec.meta?.mainPath ?? rec.files.find((f) => /\.pmx$/i.test(f.path))?.path;
    if (!mainPath) return null;
    const blob = fileMap.get(mainPath.toLowerCase());
    if (!blob) return null;
    const dir = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/') + 1) : '';
    const urlCache = new Map();
    const resolveTexture = (rel) => {
      const want = (dir + rel).toLowerCase().replace(/^\.\//, '');
      let b = fileMap.get(want);
      if (!b) {
        const base = want.split('/').pop();
        for (const [k, v] of fileMap) if (k === base || k.endsWith('/' + base)) { b = v; break; }
      }
      if (!b) return null;
      if (!urlCache.has(b)) urlCache.set(b, URL.createObjectURL(b));
      return urlCache.get(b);
    };
    return loadPMX(URL.createObjectURL(blob), resolveTexture);
  }
  const clean = model.file.split('?')[0].toLowerCase();
  if (clean.endsWith('.pmx')) {
    return loadPMX(model.file, model.file.slice(0, model.file.lastIndexOf('/') + 1));
  }
  return loadVRM(model.file, model.name);
}

/** 等模型贴图解码完再截图，否则会拍到一片黑（浔的 TGA 贴图尤其明显） */
async function waitForTextures(a, timeoutMs = 3000) {
  const mats = [];
  a.root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) mats.push(m);
  });
  const ready = () => mats.every((m) => !m.map || m.map.image);
  const t0 = performance.now();
  while (!ready() && performance.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return ready();
}

async function bakeLibraryThumbs() {
  if (libraryBake.running) return;
  const pending = modelLibrary.needsThumbs();
  if (!pending.length) {
    modelLibrary.setBakeStatus('');
    return;
  }
  libraryBake = { running: true, done: 0, total: pending.length, cancel: false };
  const savedVisible = avatar?.root.visible ?? true;
  if (avatar) avatar.root.visible = false;

  try {
    for (const model of pending) {
      if (libraryBake.cancel || !modelLibrary.isOpen()) break;
      modelLibrary.setBakeStatus('烤缩略图 ' + (libraryBake.done + 1) + '/' + libraryBake.total + '：' + model.name);
      let temp = null;
      try {
        temp = await loadSilentModel(model);
        if (!temp) continue;
        scene.add(temp.root);
        temp.root.updateMatrixWorld(true);
        // 摆个自然站姿再拍，比 T-pose 好看（applyPose 已在文件顶部静态导入）
        const idle = await fetch('/poses/neutral.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (idle && temp.humanoid) applyPose(temp.humanoid, idle);
        await waitForTextures(temp);
        await new Promise((r) => requestAnimationFrame(r));
        const dataUrl = renderPortraitToDataURL(temp);
        if (dataUrl) await modelLibrary.setThumb(model.id, dataUrl);
      } catch (err) {
        console.warn('[bake] 缩略图失败', model.name, err?.message);
      } finally {
        if (temp) {
          scene.remove(temp.root);
          try { temp.dispose?.(); } catch {}
        }
      }
      libraryBake.done += 1;
      await new Promise((r) => setTimeout(r, 30));
    }
  } finally {
    if (avatar) avatar.root.visible = savedVisible;
    libraryBake.running = false;
    modelLibrary.setBakeStatus('');
  }
}

// ---------- PNG 导出 ----------
/**
 * 按指定长边渲染一张 PNG。
 * 做法：临时把 renderer / camera / outlineEffect 改成目标尺寸 → 渲染 → 立刻取 canvas 像素 → 全部还原。
 * （没有 preserveDrawingBuffer，所以必须在同一个任务里紧接着取，不能等 rAF。）
 */
async function exportPng({ longEdge = 0, transparent = true, background = '#12141a' } = {}) {
  if (!avatar) return { ok: false, error: '没有模型' };

  const savedBg = scene.background;
  const savedGround = ground.visible;
  const savedGrid = grid.visible;
  const savedShadow = contactShadow.visible;
  const savedAspect = camera.aspect;
  const savedSize = new THREE.Vector2();
  renderer.getSize(savedSize);
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevPixelRatio = renderer.getPixelRatio();

  const w = longEdge
    ? Math.round(camera.aspect >= 1 ? longEdge : longEdge * camera.aspect)
    : renderer.domElement.width;
  const h = longEdge
    ? Math.round(camera.aspect >= 1 ? longEdge / camera.aspect : longEdge)
    : renderer.domElement.height;

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    outlineEffect.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    if (transparent) {
      scene.background = null;
      ground.visible = false;
      grid.visible = false;
      contactShadow.visible = false;
      renderer.setClearColor(0x000000, 0);
    } else {
      scene.background = new THREE.Color(background);
      renderer.setClearColor(new THREE.Color(background), 1);
    }

    outlineEffect.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');

    // 触发下载
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = dataUrl;
    a.download = `poser-${stamp}.png`;
    a.click();

    return { ok: true, width: w, height: h };
  } catch (err) {
    console.error(err);
    return { ok: false, error: err?.message ?? String(err) };
  } finally {
    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(savedSize.x, savedSize.y, false);
    outlineEffect.setSize(savedSize.x, savedSize.y);
    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
    renderer.setClearColor(prevClear, prevAlpha);
    scene.background = savedBg;
    ground.visible = savedGround;
    grid.visible = savedGrid;
    contactShadow.visible = savedShadow;
  }
}

// ---------- 角色库（首屏） ----------
// 角色库 / 模型目录共用：选中一个本机模型 → 加载 + 补缩略图
async function openModel(model) {
  ui.setStatus(`加载中：${model.name}…`);
  const a = model.source === 'local' ? await loadLocalModel(model) : await loadFromUrl(model.file, model.name);
  if (!a) {
    ui.setStatus(`加载失败：${model.name}`, 'error');
    return;
  }
  ui.setStatus(`已加载 ${model.name}（${model.game}）`);
  // 顺手补一张角色卡缩略图，下次打开就直接有图。
  // 延后到首帧之后：刚 load 完时还有异步收尾（贴图/骨骼矩阵），直接渲染会爆栈。
  setTimeout(() => {
    try {
      if (!avatar) return;
      avatar.root.updateMatrixWorld(true);
      const dataUrl = renderPortraitToDataURL();
      if (dataUrl) modelLibrary.setThumb(model.id, dataUrl);
    } catch (err) {
      console.warn('[modellib] 角色缩略图生成失败', err?.message);
    }
  }, 1500);
}

const modelLibrary = createModelLibrary({
  onPick: openModel,
  onEdit: (model) => modelMeta.open({ modelDir: model.id, ...model }),
  onDelete: async (model) => {
    if (model.source === 'local') {
      const ok = await deleteLocalModel(model.id);
      ui.setStatus(ok ? `已从浏览器收藏库删除 ${model.name}` : '删除失败', ok ? undefined : 'error');
    } else {
      const r = await deleteDiskModel(model.id);
      ui.setStatus(r?.ok ? `已删除 public/models/${model.id}/` : `删除失败：${r?.error ?? ''}`, r?.ok ? undefined : 'error');
    }
    catalog.reload();
  },
  setStatus: (msg, kind) => ui.setStatus(msg, kind),
});
window.__modelLibrary = modelLibrary;
document.getElementById('btn-modellib')?.addEventListener('click', () => {
  catalog.close();
  modelLibrary.open();
  setTimeout(bakeLibraryThumbs, 900);
});

// ---------- 模型目录（去模之屋下载的入口） ----------
const catalog = createCatalog({
  onPick: openModel,
  setStatus: (msg, kind) => ui.setStatus(msg, kind),
});
window.__catalog = catalog;
document.getElementById('btn-catalog')?.addEventListener('click', () => {
  modelLibrary.close();
  catalog.open();
});

const catalogImport = createCatalogImportUI({
  onImported: () => catalog.reload(),
  setStatus: (msg, kind) => ui.setStatus(msg, kind),
});
window.__catalogImport = catalogImport;
document.getElementById('catimport-open')?.addEventListener('click', () => catalogImport.open());

// ---------- 导出 ----------
const exportUI = createExportUI({
  onExport: (opts) => exportPng(opts),
  setStatus: (msg, kind) => ui.setStatus(msg, kind),
});
window.__exportUI = exportUI;
document.getElementById('btn-export')?.addEventListener('click', () => exportUI.open());

// ---------- 表情 ----------
const expressionPanel = createExpressionPanel({
  getAvatar: () => avatar,
  setStatus: (msg, kind) => ui.setStatus(msg, kind),
});

// ---------- 入库元数据表单 ----------
const modelMeta = createModelMetaUI({
  onSaved: () => {
    modelLibrary.reload();
    catalog.reload();
  },
  setStatus: (msg, kind) => ui.setStatus(msg, kind),
});
window.__modelMeta = modelMeta;

// 画廊里最近一次选中的条目（覆盖保存要用它的名字）
let lastPoseEntry = null;

const gallery = createGallery({
  bakeThumb,
  onApply: (pose, entry) => {
    lastPoseEntry = entry ?? null;
    ui.applyPoseData(pose, { poseId: entry?.id ?? null });
  },
  setStatus: (msg, kind) => ui.setStatus(msg, kind),
  onEditState: (n) => {
    if (n > 0) console.log('[gallery] 已覆盖保存的姿势数:', n);
  },
  getCacheKey: async (pose) => {
    const modelKey = avatar?.label ?? avatar?.kind ?? 'none';
    const t = tuning?.state ?? {};
    const rv = [APP_VERSION, t.outlineOn ? 1 : 0, t.outline, t.shading, t.sph, t.contact, t.key, t.ambient, t.rim].join('_');
    // 覆盖保存后缩略图要重烤，所以把覆盖时间戳也放进键里
    return `${modelKey}|${pose.id}|${rv}|${getOverrideStamp(pose.id)}`;
  },
});
document.getElementById('btn-gallery')?.addEventListener('click', () => gallery.open());

// ---------- 视角预设 / 自动环绕 ----------
for (const btn of document.querySelectorAll('[data-view]')) {
  btn.addEventListener('click', () => setViewPreset(btn.dataset.view));
}
const autoRotateBtn = document.getElementById('btn-autorotate');
autoRotateBtn?.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  controls.autoRotateSpeed = 0.9;
  autoRotateBtn.textContent = '自动环绕：' + (controls.autoRotate ? '开' : '关');
});

// 动作按钮
document.getElementById('btn-motion-breath')?.addEventListener('click', () => {
  startMotion(createMotion('breath'));
  ui.setStatus('已开始：呼吸待机');
});
document.getElementById('btn-motion-sway')?.addEventListener('click', () => {
  startMotion(createMotion('sway'));
  ui.setStatus('已开始：轻晃');
});
document.getElementById('btn-motion-wave')?.addEventListener('click', () => {
  startMotion(createMotion('wave'));
  ui.setStatus('已开始：挥手');
});
for (const [id, url, label] of [
  ['btn-motion-vmd1', '/motions/idle-breathe.vmd', '待机A（呼吸）'],
  ['btn-motion-vmd2', '/motions/idle-sway.vmd', '待机B（轻晃）'],
]) {
  document.getElementById(id)?.addEventListener('click', () => loadVmdUrl(url, label));
}

document.getElementById('btn-motion-stop')?.addEventListener('click', () => {
  stopMotion();
  ui.setStatus('已停止动作');
});
document.getElementById('btn-motion-play')?.addEventListener('click', (ev) => {
  if (!currentMotion) return;
  currentMotion.playing = !currentMotion.playing;
  ev.currentTarget.textContent = currentMotion.playing ? '暂停' : '播放';
});
document.getElementById('vmd-file')?.addEventListener('change', (ev) => {
  const f = ev.target.files?.[0];
  if (f) loadVmdFile(f);
  ev.target.value = '';
});
document.getElementById('motion-speed')?.addEventListener('input', (ev) => {
  const v = Number(ev.target.value) || 1;
  if (currentMotion) currentMotion.speed = v;
});

const gazeBtn = document.getElementById('btn-gaze');
gazeBtn?.addEventListener('click', () => {
  setGazeEnabled(!gaze.enabled);
  gazeBtn.textContent = '视线跟随：' + (gaze.enabled ? '开' : '关');
});
window.__gallery = gallery;

// ---------- 姿势编辑闭环：镜像 / 覆盖保存 / 撤销 ----------
function currentPoseName() {
  return lastPoseEntry?.name ?? '当前姿势';
}

ui.bindPoseEditing({
  onMirror: () => {
    if (!avatar) return;
    const exprNow = expressionPanel.getWeights();
    const mirrored = mirrorPose(capturePose(avatar.humanoid, '镜像', Object.keys(exprNow).length ? { expression: exprNow } : {}));
    ui.applyPoseData(mirrored);
    ui.setStatus('已镜像（左右互换）——满意就点「覆盖保存」');
  },
  onOverwrite: (poseId) => {
    if (!avatar) return;
    if (!poseId) {
      ui.setStatus('先在画廊里选一个姿势，再覆盖保存（否则没有目标）', 'error');
      return;
    }
    const expr = expressionPanel.getWeights();
    const meta = Object.keys(expr).length ? { expression: expr } : {};
    if (currentMotion?.motionId) {
      meta.motion = { kind: currentMotion.motionKind, id: currentMotion.motionId, name: currentMotion.name, speed: currentMotion.speed };
    }
    const pose = capturePose(avatar.humanoid, currentPoseName(), meta);
    pose.meta = { ...(pose.meta || {}), edited: true, editedAt: new Date().toISOString() };
    if (setOverride(poseId, pose)) {
      ui.setStatus(`已覆盖保存到「${currentPoseName()}」`);
      gallery.reload();
    } else {
      ui.setStatus('覆盖保存失败（浏览器存储不可用）', 'error');
    }
  },
  onRevert: (poseId) => {
    if (!poseId) {
      ui.setStatus('先在画廊里选一个姿势', 'error');
      return;
    }
    const had = clearOverride(poseId);
    ui.setStatus(had ? `已撤销「${currentPoseName()}」的修改` : '这个姿势没有修改');
    gallery.reload();
  },
});

// ---------- 渲染调节 ----------
tuning = createTuning({ apply: applyTuning, setStatus: (msg) => ui.setStatus(msg) });
window.__tuning = tuning;

// URL 参数只作为初始覆盖（面板里改了就会覆盖它）
const outlineParam = query.get('outline');
if (outlineParam !== null) {
  const v = Number(outlineParam);
  if (Number.isFinite(v)) {
    if (v <= 0) tuning.state.outlineOn = false;
    else {
      tuning.state.outlineOn = true;
      tuning.state.outline = v;
    }
    tuning.apply();
  }
}

// ?sph=0 关掉球面高光，?sph=1.2 加强
const sphParam = query.get('sph');
if (sphParam !== null) {
  const v = Number(sphParam);
  if (Number.isFinite(v)) {
    tuning.state.sph = Math.max(0, Math.min(1.5, v));
    tuning.apply();
  }
}

// ?contact=0 关掉接触阴影
const contactParam = query.get('contact');
if (contactParam !== null) {
  const v = Number(contactParam);
  if (Number.isFinite(v)) {
    tuning.state.contact = Math.max(0, Math.min(1, v));
    tuning.apply();
  }
}

// 拖拽载入
canvas.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvas.classList.add('dragging');
});
canvas.addEventListener('dragleave', () => canvas.classList.remove('dragging'));
canvas.addEventListener('drop', async (e) => {
  e.preventDefault();
  canvas.classList.remove('dragging');
  const files = await collectDroppedFiles(e.dataTransfer);
  if (!files.length) return;
  const hasPmx = files.some((f) => f.name.toLowerCase().endsWith('.pmx'));
  if (hasPmx || files.length > 1) await loadFromFiles(files);
  else await ui.handleFile(files[0]);
});
canvas.addEventListener('dblclick', () => frameAvatar());

// ---------- 动作播放 ----------
let currentMotion = null;

function stopMotion() {
  if (!currentMotion) return;
  currentMotion.stop();
  // VMD 是直接写真实骨骼的，停下后要把 retarget 还回去，否则姿势不会恢复
  avatar?.setExternalPose?.(false);
  currentMotion = null;
  ui.setPoseLocked(false);
  expressionPanel.clearMotionExpression();
  const nameEl = document.getElementById('motion-name');
  if (nameEl) nameEl.textContent = '当前：无';
}

function startMotion(motion) {
  stopMotion();
  if (!motion || !avatar) return;
  currentMotion = motion;
  ui.setPoseLocked(true);
  // 动作自带情绪表情（如挥手配微笑）
  const expr = expressionPanel.setMotionExpression(motion.expressions ?? []);
  const label = motion.name + (expr ? '（表情：' + expr + '）' : '');
  const nameEl2 = document.getElementById('motion-name');
  if (nameEl2) nameEl2.textContent = '当前：' + label;
  const nameEl = document.getElementById('motion-name');
  if (nameEl) nameEl.textContent = '当前：' + motion.name;
}

/** 按姿势里存的动作标识恢复播放 */
async function restoreMotion(motion) {
  if (!motion?.id) return false;
  if (motion.kind === 'builtin') {
    const m = createMotion(motion.id);
    m.speed = motion.speed ?? 1;
    startMotion(m);
    return true;
  }
  if (motion.kind === 'vmd' && /^\/motions\//.test(motion.id)) {
    await loadVmdUrl(motion.id, motion.name ?? 'VMD');
    return true;
  }
  if (motion.kind === 'vmd') {
    ui.setStatus('这个姿势带的是本地上传的 VMD，刷新后无法自动恢复：' + (motion.name ?? ''), 'error');
  }
  return false;
}

async function loadVmdUrl(url, label) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const player = parseVmdBuffer(await res.arrayBuffer());
    if (!player.duration) throw new Error('没有骨骼动作');
    if (!player.name) player.name = label;
    player.motionId = url;
    player.play();
    // VMD 没有情绪信息，按文件名猜一下（挥手/打招呼 → 微笑）
    player.expressions = /wave|bye|手を振|あいさつ|hello|greet|smile|笑/i.test(file.name) ? ['にっこり', '笑い', '喜び'] : [];
    startMotion(player);
    avatar?.setExternalPose?.(true);
    ui.setStatus('已载入动作 ' + label + '（' + player.duration.toFixed(1) + ' 秒，' + player.tracks.size + ' 根骨骼）');
  } catch (err) {
    console.error(err);
    ui.setStatus('动作载入失败：' + (err?.message ?? err), 'error');
  }
}

async function loadVmdFile(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const player = parseVmdBuffer(buf);
    if (!player.duration) {
      ui.setStatus('这个 vmd 里没有骨骼动作', 'error');
      return;
    }
    // 很多 vmd 内部没有动作名，用文件名兜底
    if (!player.name) player.name = file.name.replace(/\.vmd$/i, '');
    player.motionId = 'upload:' + file.name;
    player.play();
    // VMD 没有情绪信息，按文件名猜一下（挥手/打招呼 → 微笑）
    player.expressions = /wave|bye|手を振|あいさつ|hello|greet|smile|笑/i.test(file.name) ? ['にっこり', '笑い', '喜び'] : [];
    startMotion(player);
    avatar?.setExternalPose?.(true);
    ui.setStatus('已载入动作 ' + file.name + '（' + player.duration.toFixed(1) + ' 秒，' + player.tracks.size + ' 根骨骼）');
  } catch (err) {
    console.error(err);
    ui.setStatus('VMD 解析失败：' + (err?.message ?? err), 'error');
  }
}

// ---------- 视线跟随 ----------
// 指针在画面上指哪儿，角色的头/颈就朝哪儿转（带角度上限和阻尼）。
let gazeSaved = [];
const gaze = {
  enabled: true,
  pointer: new THREE.Vector2(0, 0),
  hasPointer: false,
  yaw: 0,
  pitch: 0,
};
const GAZE_MAX_YAW = THREE.MathUtils.degToRad(42);
const GAZE_MAX_PITCH = THREE.MathUtils.degToRad(26);

const _gaze = {
  headPos: new THREE.Vector3(),
  target: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  local: new THREE.Vector3(),
  plane: new THREE.Plane(),
  ray: new THREE.Raycaster(),
  q: new THREE.Quaternion(),
  qDelta: new THREE.Quaternion(),
  v: new THREE.Vector3(),
  euler: new THREE.Euler(),
};

function setGazeEnabled(on) {
  gaze.enabled = on;
  if (!on) {
    gaze.yaw = 0;
    gaze.pitch = 0;
  }
  return gaze.enabled;
}

function updateGaze(dt) {
  const head = avatar?.humanoid?.getNormalizedBoneNode?.('head');
  const neck = avatar?.humanoid?.getNormalizedBoneNode?.('neck');
  if (!head) return [];

  let wantYaw = 0;
  let wantPitch = 0;
  if (gaze.enabled && gaze.hasPointer) {
    // 取"相机与头部之间的某个点"当目标：
    // - 直接把射线投到过头部的平面上，中心点会退化成头骨本身（方向向量≈0，atan2 乱跳）
    // - 取更远的点又会让方向翻到脑后
    // 用 0.5 × 相机距头部的距离，方向永远朝相机一侧，中心点自然收敛到 0。
    head.getWorldPosition(_gaze.headPos);
    const camDist = camera.position.distanceTo(_gaze.headPos);
    _gaze.ray.setFromCamera(gaze.pointer, camera);
    _gaze.target.copy(camera.position).addScaledVector(_gaze.ray.ray.direction, camDist * 0.5);
    _gaze.dir.subVectors(_gaze.target, _gaze.headPos);
    // 换算到角色根节点局部：模型被旋转过也不会错
    const rootQ = avatar.root.getWorldQuaternion(_gaze.q).invert();
    _gaze.local.copy(_gaze.dir).applyQuaternion(rootQ);
    if (_gaze.local.lengthSq() > 1e-8) {
      _gaze.local.normalize();
      // 约定 +Z 为正前，+X 为角色左手边
      wantYaw = THREE.MathUtils.clamp(
        Math.atan2(_gaze.local.x, _gaze.local.z),
        -GAZE_MAX_YAW,
        GAZE_MAX_YAW,
      );
      wantPitch = THREE.MathUtils.clamp(
        Math.atan2(-_gaze.local.y, Math.hypot(_gaze.local.x, _gaze.local.z)),
        -GAZE_MAX_PITCH,
        GAZE_MAX_PITCH,
      );
    }
  }

  const k = Math.min(1, dt * 8);
  gaze.yaw += (wantYaw - gaze.yaw) * k;
  gaze.pitch += (wantPitch - gaze.pitch) * k;
  if (Math.abs(gaze.yaw) < 1e-4 && Math.abs(gaze.pitch) < 1e-4) return [];

  // 头 70% / 颈 30%，比只转头自然。
  // 改的是"这一帧"的骨骼姿态，必须在渲染后还原：avatar.update() 是朝目标姿势插值的，
  // 不还原的话下一帧会从叠加后的姿态继续转，越滚越大（实测能到 160°）。
  const saved = [];
  for (const [bone, share] of [
    [head, 0.7],
    [neck, 0.3],
  ]) {
    if (!bone) continue;
    saved.push([bone, bone.quaternion.clone()]);
    _gaze.euler.set(gaze.pitch * share, gaze.yaw * share, 0, 'YXZ');
    _gaze.qDelta.setFromEuler(_gaze.euler);
    bone.quaternion.multiply(_gaze.qDelta);
  }
  // 改的是 humanoid 代理骨骼，蒙皮用的是真实 MMD 骨骼：
  // avatar.update() 里的重定向已经在改之前跑完了，这里必须再推一次，否则画面不动。
  avatar.retarget?.();
  return saved;
}

function restoreGaze(saved) {
  if (!saved?.length) return;
  for (const [bone, q] of saved) bone.quaternion.copy(q);
}

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  gaze.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  gaze.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  gaze.hasPointer = true;
});
canvas.addEventListener('pointerleave', () => {
  gaze.hasPointer = false;
});

// 系统「减少动效」：不主动提示，但把默认值交给各模块（眨眼已处理）
const prefersReducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
if (prefersReducedMotion) console.log('[poser] 检测到 prefers-reduced-motion，自动眨眼默认关闭');

// ---------- 主循环 ----------
let lastTime = performance.now();
function tick() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (avatar) {
    avatar.update(dt);
    ui.syncFromAvatar(dt);
    updateContactShadow();
    currentMotion?.update(dt, avatar);
    gazeSaved = updateGaze(dt);
  }
  controls.update();

  // 相机钻到地面以下时，把地板和网格藏起来，否则从下往上只能看到一块地板
  const belowFloor = camera.position.y < 0.02;
  ground.visible = !belowFloor;
  grid.visible = !belowFloor;

  outlineEffect.render(scene, camera);
  // 视线是"只影响这一帧"的叠加，渲染完立刻还原
  restoreGaze(gazeSaved);
  gazeSaved = [];
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  outlineEffect.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 启动 ----------
const params = new URLSearchParams(location.search);
const modelParam = params.get('model');
const poseParam = params.get('pose');


async function boot() {
  if (modelParam) {
    // 深链：?model=/models/xxx/yyy.pmx 直接进姿势台
    const a = await loadFromUrl(modelParam, modelParam.split('/').pop());
    if (!a) useMannequin();
  } else {
    // 默认先进角色库挑人；背后放个人偶撑着，切进来不会黑屏
    useMannequin();
    ui.setStatus('在角色库里选一个角色开始');
    modelLibrary.open();
    setTimeout(bakeLibraryThumbs, 1200);
  }

  // ?pose=/poses/wave.json —— 深链直接摆好某个姿势，也方便自动化截图
  if (poseParam) {
    try {
      const res = await fetch(poseParam);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ui.applyPoseData(await res.json());
    } catch (err) {
      ui.setStatus(`姿势参数读取失败：${err.message}`, 'error');
    }
  }
  window.__poserReady = true;
}

boot();

tick();

// 调试入口
window.__THREE = THREE;
window.__loadFromFiles = loadFromFiles;
window.__poser = {  scene,
  camera,
  controls,
  get avatar() {
    return avatar;
  },
  get ready() {
    return !!window.__poserReady;
  },
  frameAvatar,
  setViewPreset,
  setGazeEnabled,
  gaze,
  useMannequin,
  contactShadow,
  ground,
  grid,
  loadFromUrl,
  // 调试/测试入口：多视图融合 → 姿势
  applyFusedLandmarks: (views) => {
    const fused = fuseViews(views);
    if (!fused) return null;
    const pose = landmarksToPose(avatar, fused);
    if (pose) ui.applyPoseData(pose);
    return pose;
  },
  // 调试/测试入口：关键点 → 姿势 → 直接套到当前模型
  landmarksToPose: (world) => landmarksToPose(avatar, world),
  /** 测试用：直接套一个姿势（会走 onBeforePose → 停掉动作） */
  applyPose: (pose) => ui.applyPoseData(pose),
  exportPng,
  expressions: expressionPanel,
  applyLandmarks: (world) => {
    const pose = landmarksToPose(avatar, world);
    if (pose) ui.applyPoseData(pose);
    return pose;
  },
  applyPreset: async (url) => {
    const res = await fetch(url);
    return ui.applyPoseData(await res.json());
  },
};


































































