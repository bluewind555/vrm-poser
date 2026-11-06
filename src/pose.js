import * as THREE from 'three';

/**
 * VRM 归一化人形骨骼（Humanoid）——姿势数据只读写这一层。
 * 归一化骨骼的 rest 是标准 T-pose，与具体模型的原始骨骼命名/朝向无关，
 * 所以同一份姿势 JSON 可以套到任意 VRM 上（缺失骨骼自动跳过）。
 */
export const HUMANOID_BONES = [
  { name: 'hips', label: '髋', group: '躯干' },
  { name: 'spine', label: '腰', group: '躯干' },
  { name: 'chest', label: '胸', group: '躯干' },
  { name: 'upperChest', label: '上胸', group: '躯干' },
  { name: 'neck', label: '颈', group: '躯干' },
  { name: 'head', label: '头', group: '躯干' },

  { name: 'leftShoulder', label: '左肩', group: '左臂' },
  { name: 'leftUpperArm', label: '左上臂', group: '左臂' },
  { name: 'leftLowerArm', label: '左小臂', group: '左臂' },
  { name: 'leftHand', label: '左手', group: '左臂' },

  { name: 'rightShoulder', label: '右肩', group: '右臂' },
  { name: 'rightUpperArm', label: '右上臂', group: '右臂' },
  { name: 'rightLowerArm', label: '右小臂', group: '右臂' },
  { name: 'rightHand', label: '右手', group: '右臂' },

  { name: 'leftUpperLeg', label: '左大腿', group: '左腿' },
  { name: 'leftLowerLeg', label: '左小腿', group: '左腿' },
  { name: 'leftFoot', label: '左脚', group: '左腿' },
  { name: 'leftToes', label: '左趾', group: '左腿' },

  { name: 'rightUpperLeg', label: '右大腿', group: '右腿' },
  { name: 'rightLowerLeg', label: '右小腿', group: '右腿' },
  { name: 'rightFoot', label: '右脚', group: '右腿' },
  { name: 'rightToes', label: '右趾', group: '右腿' },
];

export const BONE_NAMES = HUMANOID_BONES.map((b) => b.name);

export const POSE_FORMAT = 'vrm-pose/1';

// 左右配对：镜像姿势时互换，并把旋转的 y/z 分量取反（跨矢状面反射）
const MIRROR_PAIRS = {
  leftShoulder: 'rightShoulder',
  leftUpperArm: 'rightUpperArm',
  leftLowerArm: 'rightLowerArm',
  leftHand: 'rightHand',
  leftUpperLeg: 'rightUpperLeg',
  leftLowerLeg: 'rightLowerLeg',
  leftFoot: 'rightFoot',
  leftToes: 'rightToes',
};
// 反向表
for (const [l, r] of Object.entries(MIRROR_PAIRS)) MIRROR_PAIRS[r] = l;

/**
 * 镜像一个姿势（左右互换）。
 * 归一化骨骼是对称的 T-pose，所以：
 * - 骨骼名按左右配对互换
 * - 四元数把 y/z 分量取反（等价于跨矢状面反射后重新求旋转）
 * - hips 偏移的 x 取反
 */
export function mirrorPose(pose) {
  if (!pose) return pose;
  const out = {
    ...pose,
    meta: { ...(pose.meta || {}), mirrored: !pose.meta?.mirrored },
    bones: {},
  };
  for (const [name, q] of Object.entries(pose.bones || {})) {
    const target = MIRROR_PAIRS[name] || name;
    out.bones[target] = [q[0], -q[1], -q[2], q[3]];
  }
  if (Array.isArray(pose.hips)) out.hips = [-pose.hips[0], pose.hips[1], pose.hips[2]];
  return out;
}

const _rest = new WeakMap();
const _euler = new THREE.Euler();
const _v = new THREE.Vector3();

/** 取归一化骨骼节点；模型缺骨骼时返回 null */
export function getNode(humanoid, name) {
  if (!humanoid) return null;
  try {
    return humanoid.getNormalizedBoneNode(name) || null;
  } catch {
    return null;
  }
}

/** 记住 rest 姿势（第一次访问时快照），姿势数据全部相对它 */
function restOf(humanoid) {
  let map = _rest.get(humanoid);
  if (map) return map;
  map = new Map();
  for (const name of BONE_NAMES) {
    const node = getNode(humanoid, name);
    if (node) map.set(name, { q: node.quaternion.clone(), p: node.position.clone() });
  }
  _rest.set(humanoid, map);
  return map;
}

export function setHipsOffset(humanoid, [x, y, z]) {
  const node = getNode(humanoid, 'hips');
  const rest = restOf(humanoid).get('hips');
  if (!node || !rest) return;
  node.position.set(rest.p.x + x, rest.p.y + y, rest.p.z + z);
}

export function getHipsOffset(humanoid) {
  const node = getNode(humanoid, 'hips');
  const rest = restOf(humanoid).get('hips');
  if (!node || !rest) return [0, 0, 0];
  return [node.position.x - rest.p.x, node.position.y - rest.p.y, node.position.z - rest.p.z];
}

/** 读取当前姿势 → 可直接序列化的 JSON 对象 */
export function capturePose(humanoid, name = 'untitled', meta = {}) {
  const bones = {};
  for (const bone of BONE_NAMES) {
    const node = getNode(humanoid, bone);
    if (!node) continue;
    const q = node.quaternion;
    if (Math.abs(q.w) > 0.999999 && Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) < 1e-6) continue; // 恒等跳过，省体积
    bones[bone] = [q.x, q.y, q.z, q.w].map((n) => Math.round(n * 1e5) / 1e5);
  }
  const hips = getHipsOffset(humanoid).map((n) => Math.round(n * 1e4) / 1e4);
  const pose = { format: POSE_FORMAT, name, meta, bones };
  if (hips.some((n) => Math.abs(n) > 1e-5)) pose.hips = hips;
  return pose;
}

function applyBoneIfPresent(humanoid, name, rot) {
  const node = getNode(humanoid, name);
  if (!node || !Array.isArray(rot) || rot.length !== 4) return false;
  node.quaternion.fromArray(rot);
  return true;
}

/**
 * 应用姿势：先归零全部骨骼，再套用 JSON 里出现的骨骼。
 * 缺失的骨骼静默跳过 —— 这是跨模型复用的关键容错点。
 * @returns {{applied:number, missing:string[]}}
 */
export function applyPose(humanoid, pose = {}) {
  if (!humanoid) return { applied: 0, missing: [] };
  const rest = restOf(humanoid);
  const wasAuto = humanoid.autoUpdateHumanBones;

  // 批量应用时关掉自动同步，避免每根骨骼都触发一次 normalized -> raw 的拷贝
  if (typeof wasAuto === 'boolean') humanoid.autoUpdateHumanBones = false;

  for (const [name, r] of rest) {
    const node = getNode(humanoid, name);
    if (!node) continue;
    node.quaternion.copy(r.q);
    node.position.copy(r.p);
  }

  let applied = 0;
  const missing = [];
  for (const [name, rot] of Object.entries(pose.bones || {})) {
    if (applyBoneIfPresent(humanoid, name, rot)) applied += 1;
    else missing.push(name);
  }
  if (Array.isArray(pose.hips) && pose.hips.length === 3) setHipsOffset(humanoid, pose.hips);

  // 交还给 vrm.update() 统一同步一次
  if (typeof wasAuto === 'boolean') humanoid.autoUpdateHumanBones = wasAuto;
  return { applied, missing };
}

export function resetBone(humanoid, name) {
  const rest = restOf(humanoid).get(name);
  const node = getNode(humanoid, name);
  if (!rest || !node) return;
  node.quaternion.copy(rest.q);
  node.position.copy(rest.p);
}

export function resetAll(humanoid) {
  applyPose(humanoid, { bones: {} });
}

/** 当前骨骼的欧拉角（度，XYZ 序）——只用于 UI 滑条显示 */
export function getEulerDegrees(humanoid, name) {
  const node = getNode(humanoid, name);
  if (!node) return [0, 0, 0];
  _euler.setFromQuaternion(node.quaternion, 'XYZ');
  return [_euler.x, _euler.y, _euler.z].map((r) => Math.round(THREE.MathUtils.radToDeg(r) * 10) / 10);
}

export function setEulerDegrees(humanoid, name, [dx, dy, dz]) {
  const node = getNode(humanoid, name);
  if (!node) return;
  _euler.set(
    THREE.MathUtils.degToRad(dx),
    THREE.MathUtils.degToRad(dy),
    THREE.MathUtils.degToRad(dz),
    'XYZ',
  );
  node.quaternion.setFromEuler(_euler);
}

/**
 * 接地校正：把整个模型沿 Y 平移，让最低点落到地面上。
 *
 * 关键：**每次都从 y=0 开始量、再一次性设定**，而不是"在当前高度上再加偏移"。
 * 后者只要测量有微小偏差，每点一次就会累加一点（表现为模型不断升空）。
 *
 * @param {(name: string, out: THREE.Vector3) => THREE.Vector3|null} [opts.getBoneWorldPosition]
 *        PMX 这类模型没有"归一化骨骼"实体，由 avatar 自己提供真实骨骼的世界坐标
 * @param {() => number|null} [opts.getLowestY]
 *        蒙皮后模型的最低点（世界 Y），PMX 由 loader 精确计算
 */
export function snapToGround(root, humanoid, { clearance = 0.03, getBoneWorldPosition = null, getLowestY = null } = {}) {
  if (!root) return 0;

  const measure = () => {
    // 先归零再量，保证可重复：点 N 次 == 点 1 次
    root.position.y = 0;
    root.updateMatrixWorld(true);

    if (typeof getLowestY === 'function') {
      const y = getLowestY();
      if (Number.isFinite(y)) return y;
    }

    let minY = Infinity;
    for (const name of ['leftFoot', 'rightFoot', 'leftToes', 'rightToes', 'leftLowerLeg', 'rightLowerLeg']) {
      let hit = null;
      if (typeof getBoneWorldPosition === 'function') {
        hit = getBoneWorldPosition(name, _v);
      } else if (humanoid) {
        const node = getNode(humanoid, name);
        if (node) hit = node.getWorldPosition(_v);
      }
      if (hit) minY = Math.min(minY, hit.y);
    }
    return Number.isFinite(minY) ? minY : null;
  };

  const y = measure();
  if (y === null) {
    root.updateMatrixWorld(true);
    return 0;
  }
  const delta = clearance - y;
  root.position.y = delta;
  root.updateMatrixWorld(true);

  // 臀部保护：坐姿时脚可能悬空、真正接触的是屁股。
  // 只按脚接地会让整个人沉进地面，所以兜一层——臀部低于阈值就整体抬起来。
  if (typeof getBoneWorldPosition === 'function') {
    const hips = getBoneWorldPosition('hips', _v);
    if (hips && hips.y < 0.02) {
      root.position.y += 0.02 - hips.y;
      root.updateMatrixWorld(true);
    }
  }
  return delta;
}

/** 合并两份姿势（后者覆盖前者），用于叠加/修正 */
export function mergePose(base, patch) {
  return {
    format: POSE_FORMAT,
    name: patch.name || base.name,
    meta: { ...(base.meta || {}), ...(patch.meta || {}) },
    bones: { ...(base.bones || {}), ...(patch.bones || {}) },
    hips: patch.hips || base.hips,
  };
}

export function clonePose(pose) {
  return JSON.parse(JSON.stringify(pose));
}
