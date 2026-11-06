import * as THREE from 'three';
import { applyPose, capturePose } from './pose.js';

/**
 * MediaPipe Pose Landmarker 的 33 个关键点 → 归一化人形骨骼的旋转。
 *
 * 只取"方向"，不搬"位置"：
 * 关键点的绝对坐标属于照片里那个人（骨长和我们的模型不一样），
 * 直接搬会把模型拉变形；只有关节之间的**朝向**是跨模型通用的。
 */

// MediaPipe 关键点索引
export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lToe: 31,
  rToe: 32,
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * 用「髋→肩」当上方向、「左髋−右髋」当左方向，构造相机空间 → 模型空间的基。
 * 这样正面图、侧面图、45° 图都能落到同一个坐标系里（否则侧视图会被当成正面压扁）。
 */
export function buildBasis(world) {
  const P = (i) => new THREE.Vector3(world[i][0], world[i][1], world[i][2]);
  const hipL = P(LM.lHip);
  const hipR = P(LM.rHip);
  const shL = P(LM.lShoulder);
  const shR = P(LM.rShoulder);

  const hipCenter = hipL.clone().add(hipR).multiplyScalar(0.5);
  const shCenter = shL.clone().add(shR).multiplyScalar(0.5);

  const up = shCenter.clone().sub(hipCenter);
  if (up.lengthSq() < 1e-8) up.set(0, -1, 0);
  up.normalize();

  let left = hipL.clone().sub(hipR);
  if (left.lengthSq() < 1e-8) left.set(1, 0, 0);
  // 去掉与 up 平行的分量，保证正交
  left.addScaledVector(up, -left.dot(up));
  if (left.lengthSq() < 1e-8) left.set(1, 0, 0);
  left.normalize();

  // forward = left × up（右手系，对应模型 +Z 朝观察者）
  const forward = new THREE.Vector3().crossVectors(left, up).normalize();
  // 重新正交化 left，防止数值漂移
  left.crossVectors(up, forward).normalize();

  // 基矩阵：列向量 = 模型轴在相机空间里的表示
  const m = new THREE.Matrix4().makeBasis(left, up, forward);
  return { matrix: m, inverse: m.clone().invert(), hipCenter, shCenter, up, left, forward };
}

/** 把相机空间的关键点转到模型空间 */
function toModelSpace(world, basis) {
  return world.map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(basis.inverse));
}

/**
 * 把一根骨骼"瞄准"某个世界方向。
 * 用当前世界朝向算一个最小旋转，再把结果写回局部四元数。
 */
function aimBone(node, childNode, targetDir) {
  if (!node || !childNode) return false;
  node.updateWorldMatrix(true, true);
  const p0 = node.getWorldPosition(_a);
  const p1 = childNode.getWorldPosition(_b);
  const cur = _c.subVectors(p1, p0);
  if (cur.lengthSq() < 1e-10) return false;
  cur.normalize();

  const q = new THREE.Quaternion().setFromUnitVectors(cur, targetDir);
  const worldQ = new THREE.Quaternion();
  node.getWorldQuaternion(worldQ);
  const nextWorld = q.multiply(worldQ);

  const parent = node.parent;
  let local;
  if (parent) {
    const pq = new THREE.Quaternion();
    parent.getWorldQuaternion(pq);
    local = pq.invert().multiply(nextWorld);
  } else {
    local = nextWorld;
  }
  node.quaternion.copy(local);
  node.updateMatrixWorld(true);
  return true;
}

/**
 * 多视图融合。
 *
 * 每个视图都给出同一组关节的 3D 坐标，但**深度方向的误差远大于画面内的误差**：
 * 正面图能准确给出左右、上下，前后基本靠猜；侧面图正好反过来。
 * 所以不能简单平均——按"该视图的视线方向与各坐标轴的夹角"逐轴加权：
 * 视线与某轴越接近平行，该轴在这个视图里越不可信。
 *
 * @param {{world:number[][], name?:string}[]} views 至少一个视图
 * @returns {number[][]} 融合后的 33 个关键点（[x,y,z,visibility]）
 */
export function fuseViews(views) {
  const valid = (views || []).filter((v) => Array.isArray(v?.world) && v.world.length >= 33);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0].world;

  const n = 33;
  const sum = new Float64Array(n * 3);
  const wsum = new Float64Array(n * 3);
  const visOut = new Float64Array(n);

  for (const view of valid) {
    const basis = buildBasis(view.world);
    // 相机视线（相机空间 -Z）转到模型空间
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(basis.inverse).normalize();
    // 逐轴可信度：视线与某轴越平行 → 该轴越不可信
    const axisW = [0, 1, 2].map((k) => Math.max(0.12, 1 - Math.abs(dir.getComponent(k))));
    const pts = toModelSpace(view.world, basis);

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const conf = Math.min(1, Math.max(0.2, view.world[i][3] ?? 1));
      for (let k = 0; k < 3; k++) {
        const w = axisW[k] * conf;
        sum[i * 3 + k] += p.getComponent(k) * w;
        wsum[i * 3 + k] += w;
      }
      visOut[i] = Math.max(visOut[i], view.world[i][3] ?? 0);
    }
  }

  const fused = [];
  for (let i = 0; i < n; i++) {
    const out = [0, 0, 0, visOut[i]];
    for (let k = 0; k < 3; k++) {
      out[k] = wsum[i * 3 + k] > 0 ? sum[i * 3 + k] / wsum[i * 3 + k] : 0;
    }
    fused.push(out);
  }
  return fused;
}

/**
 * 关键点 → 姿势。
 * @param {object} avatar 当前模型（需要有 vrm.humanoid 或等价接口）
 * @param {number[][]} world MediaPipe worldLandmarks（33 × [x,y,z,visibility]）
 * @returns {object|null} vrm-pose/1 格式的姿势
 */
export function landmarksToPose(avatar, world, { armOut = 0.14, legOut = 0.06, avoidCollision = true } = {}) {
  const humanoid = avatar?.humanoid;
  if (!humanoid || !Array.isArray(world) || world.length < 33) return null;

  const basis = buildBasis(world);
  const pts = toModelSpace(world, basis);
  const P = (i) => pts[i];

  const dir = (fromIdx, toIdx) => {
    const v = new THREE.Vector3().subVectors(P(toIdx), P(fromIdx));
    return v.lengthSq() > 1e-8 ? v.normalize() : null;
  };
  const mid = (i, j) => new THREE.Vector3().addVectors(P(i), P(j)).multiplyScalar(0.5);

  const hipMid = mid(LM.lHip, LM.rHip);
  const shMid = mid(LM.lShoulder, LM.rShoulder);
  const torso = new THREE.Vector3().subVectors(shMid, hipMid);
  const torsoDir = torso.lengthSq() > 1e-8 ? torso.normalize() : new THREE.Vector3(0, 1, 0);
  const headDir = new THREE.Vector3().subVectors(P(LM.nose), shMid);
  const headUp = headDir.lengthSq() > 1e-8 ? headDir.normalize() : torsoDir.clone();

  // 身体左右轴（模型空间 +X = 角色左侧）
  const sideAxis = new THREE.Vector3().subVectors(P(LM.lHip), P(LM.rHip));
  if (sideAxis.lengthSq() < 1e-8) sideAxis.set(1, 0, 0);
  sideAxis.normalize();

  /** 肩中心 → 某侧肩关节（锁骨朝向） */
  const dirTo = (idx) => {
    const v = new THREE.Vector3().subVectors(P(idx), shMid);
    return v.lengthSq() > 1e-8 ? v.normalize() : null;
  };


  // 外展余量（可用 URL 参数调：?armout=0.2&legout=0）
  const ARM_OUT = armOut;
  const LEG_OUT = legOut;

  // 先把模型归到"零姿势"，再逐段瞄准
  const node = (name) => humanoid.getNormalizedBoneNode?.(name) ?? null;
  applyPose(humanoid, { format: 'vrm-pose/1', bones: {}, hips: [0, 0, 0] });

  // 1) 躯干
  for (const [boneName, childName, target] of [
    ['spine', 'chest', torsoDir],
    ['chest', 'upperChest', torsoDir],
    ['upperChest', 'neck', torsoDir],
  ]) {
    if (!target) continue;
    const b = node(boneName);
    const c = node(childName);
    if (b && c) aimBone(b, c, target);
  }

  // 2) 锁骨：从肩中心指向肩关节。不驱动的话手臂根部是收着的，
  //    手臂一动就插进躯干。
  for (const [boneName, childName, target] of [
    ['leftShoulder', 'leftUpperArm', dirTo(LM.lShoulder)],
    ['rightShoulder', 'rightUpperArm', dirTo(LM.rShoulder)],
  ]) {
    if (!target) continue;
    const b = node(boneName);
    const c = node(childName);
    if (b && c) aimBone(b, c, target);
  }

  // 3) 四肢：两骨 IK
  //   只对齐"方向"不够：我们的模型手臂比参考白模长，指向同一个方向时手会"过头"戳进头里。
  //   所以把末端（手/脚）放到参考里的**位置**上，再用余弦定理反解肘/膝。
  const boneLen = (a, b) =>
    a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));

  // ---- 碰撞代理：躯干当胶囊、头当球 ----
  // 用骨骼位置粗估尺寸（不依赖网格），够把手臂从身体里推出来。
  const hipsNode = node('hips');
  const chestNode = node('upperChest') ?? node('chest');
  const headNode = node('head');
  const neckNode = node('neck');
  const shLNode = node('leftUpperArm');
  const shRNode = node('rightUpperArm');

  const proxies = (() => {
    if (!hipsNode || !chestNode) return null;
    const a = hipsNode.getWorldPosition(new THREE.Vector3());
    const b = chestNode.getWorldPosition(new THREE.Vector3());
    const head = headNode ? headNode.getWorldPosition(new THREE.Vector3()) : null;
    const neck = neckNode ? neckNode.getWorldPosition(new THREE.Vector3()) : null;
    const shoulderSpan = shLNode && shRNode ? boneLen(shLNode, shRNode) : 0.34;
    return {
      a,
      b,
      torsoR: Math.max(0.05, shoulderSpan * 0.34),
      head,
      headR: head && neck ? Math.max(0.06, neck.distanceTo(head) * 0.9) : 0.1,
    };
  })();

  const closestOnSegment = (p, a, b, out) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const t = THREE.MathUtils.clamp(
      new THREE.Vector3().subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-9),
      0,
      1,
    );
    return out.copy(a).addScaledVector(ab, t);
  };

  /** 手臂/腿与躯干胶囊、头球的侵入深度（取最严重的一处 + 推开方向） */
  const penetration = (rootPos, jointPos, endPos, limbR, includeHead) => {
    if (!proxies) return null;
    const nearest = new THREE.Vector3();
    let worst = 0;
    let push = null;
    for (const [s, e] of [
      [rootPos, jointPos],
      [jointPos, endPos],
    ]) {
      for (let i = 0; i <= 6; i++) {
        const p = s.clone().lerp(e, i / 6);
        // 躯干
        closestOnSegment(p, proxies.a, proxies.b, nearest);
        const dTorso = p.distanceTo(nearest);
        const penT = proxies.torsoR + limbR - dTorso;
        if (penT > worst) {
          worst = penT;
          push = p.clone().sub(nearest);
          if (push.lengthSq() < 1e-8) push.copy(sideAxis);
          push.normalize();
        }
        // 头
        if (includeHead && proxies.head) {
          const dHead = p.distanceTo(proxies.head);
          const penH = proxies.headR + limbR - dHead;
          if (penH > worst) {
            worst = penH;
            push = p.clone().sub(proxies.head);
            if (push.lengthSq() < 1e-8) push.set(0, 1, 0);
            push.normalize();
          }
        }
      }
    }
    return push ? { depth: worst, dir: push } : null;
  };

  const solveLimb = ({
    rootName,
    midName,
    endName,
    refRoot,
    refMid,
    refEnd,
    outSign,
    outAmount,
    collide = false,
    includeHead = false,
    limbR = 0.045,
  }) => {
    const root = node(rootName);
    const mid = node(midName);
    const end = node(endName);
    if (!root || !mid || !end) return;

    const l1 = boneLen(root, mid);
    const l2 = boneLen(mid, end);
    if (l1 <= 1e-5 || l2 <= 1e-5) return;

    const refSpan = refRoot.distanceTo(refMid) + refMid.distanceTo(refEnd);
    if (refSpan < 1e-6) return;
    const k = (l1 + l2) / refSpan; // 参考骨架 → 本模型的尺度

    const rootPos = root.getWorldPosition(new THREE.Vector3());
    const target = rootPos
      .clone()
      .addScaledVector(new THREE.Vector3().subVectors(refEnd, refRoot), k);
    // 外展余量：把末端往外推一点，抵消模型比白模胖的差异
    if (outAmount) target.addScaledVector(sideAxis, outSign * outAmount * (l1 + l2) * 0.28);

    /** 按给定末端目标解一次 IK，返回关节世界坐标 */
    const place = () => {
      const toTarget = new THREE.Vector3().subVectors(target, rootPos);
      const dist = THREE.MathUtils.clamp(
        toTarget.length(),
        Math.abs(l1 - l2) + 0.01,
        (l1 + l2) * 0.995,
      );
      const dirN = toTarget.normalize();

      const proj = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
      const offset = Math.sqrt(Math.max(l1 * l1 - proj * proj, 0));

      // 弯曲平面：用参考里"中间关节相对根→末端的偏移方向"
      const poleRef = new THREE.Vector3().subVectors(refMid, refRoot);
      const perp = poleRef.clone().sub(dirN.clone().multiplyScalar(poleRef.dot(dirN)));
      if (perp.lengthSq() < 1e-8) {
        perp.copy(sideAxis).sub(dirN.clone().multiplyScalar(sideAxis.dot(dirN)));
      }
      if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
      perp.normalize();

      const jointPos = rootPos.clone().addScaledVector(dirN, proj).addScaledVector(perp, offset);
      const endPos = rootPos.clone().addScaledVector(dirN, dist);

      aimBone(root, mid, new THREE.Vector3().subVectors(jointPos, rootPos).normalize());
      aimBone(mid, end, new THREE.Vector3().subVectors(endPos, jointPos).normalize());
      return { jointPos, endPos };
    };

    let pos = place();
    // 迭代避让：侵入就沿"向外"方向把目标推出去，再重解
    if (collide && avoidCollision) {
      for (let iter = 0; iter < 6; iter++) {
        const hit = penetration(rootPos, pos.jointPos, pos.endPos, limbR, includeHead);
        if (!hit || hit.depth < 0.004) break;
        target.addScaledVector(hit.dir, hit.depth * 1.25);
        pos = place();
      }
    }
  };

  solveLimb({
    rootName: 'leftUpperArm',
    midName: 'leftLowerArm',
    endName: 'leftHand',
    refRoot: P(LM.lShoulder),
    refMid: P(LM.lElbow),
    refEnd: P(LM.lWrist),
    outSign: 1,
    outAmount: ARM_OUT,
    collide: true,
    includeHead: true,
  });
  solveLimb({
    rootName: 'rightUpperArm',
    midName: 'rightLowerArm',
    endName: 'rightHand',
    refRoot: P(LM.rShoulder),
    refMid: P(LM.rElbow),
    refEnd: P(LM.rWrist),
    outSign: -1,
    outAmount: ARM_OUT,
    collide: true,
    includeHead: true,
  });
  solveLimb({
    rootName: 'leftUpperLeg',
    midName: 'leftLowerLeg',
    endName: 'leftFoot',
    refRoot: P(LM.lHip),
    refMid: P(LM.lKnee),
    refEnd: P(LM.lAnkle),
    outSign: 1,
    outAmount: LEG_OUT,
  });
  solveLimb({
    rootName: 'rightUpperLeg',
    midName: 'rightLowerLeg',
    endName: 'rightFoot',
    refRoot: P(LM.rHip),
    refMid: P(LM.rKnee),
    refEnd: P(LM.rAnkle),
    outSign: -1,
    outAmount: LEG_OUT,
  });

  // 4) 脚掌朝向：踝 → 脚尖
  for (const [boneName, childName, target] of [
    ['leftFoot', 'leftToes', dir(LM.lAnkle, LM.lToe)],
    ['rightFoot', 'rightToes', dir(LM.rAnkle, LM.rToe)],
  ]) {
    if (!target) continue;
    const b = node(boneName);
    const c = node(childName);
    if (b && c) aimBone(b, c, target);
  }




  avatar.root.updateMatrixWorld(true);

  // 每根骨骼的可信度 = 定义它方向的那两个关键点的 visibility 最小值。
  // 前端据此把"估计不准"的关节标出来，引导用户去微调，而不是盲目全调。
  const vis = (i) => (typeof world[i][3] === 'number' ? world[i][3] : 1);
  const pair = (i, j) => Math.round(Math.min(vis(i), vis(j)) * 100) / 100;
  const confidence = {
    spine: pair(LM.lShoulder, LM.rShoulder),
    chest: pair(LM.lShoulder, LM.rShoulder),
    upperChest: pair(LM.lShoulder, LM.rShoulder),
    neck: pair(LM.lShoulder, LM.rShoulder),
    leftUpperArm: pair(LM.lShoulder, LM.lElbow),
    leftLowerArm: pair(LM.lElbow, LM.lWrist),
    rightUpperArm: pair(LM.rShoulder, LM.rElbow),
    rightLowerArm: pair(LM.rElbow, LM.rWrist),
    leftUpperLeg: pair(LM.lHip, LM.lKnee),
    leftLowerLeg: pair(LM.lKnee, LM.lAnkle),
    leftFoot: pair(LM.lAnkle, LM.lToe),
    rightUpperLeg: pair(LM.rHip, LM.rKnee),
    rightLowerLeg: pair(LM.rKnee, LM.rAnkle),
    rightFoot: pair(LM.rAnkle, LM.rToe),
  };

  // 躺卧姿势标记：单目姿态估计对"躺着的人"基本失效（实测正面/俯视 12 种预处理组合全部检不出），
  // 侥幸检出的结果也常被拉成站姿。标记出来让界面提示"需手修"。
  // 注意要用**原始关键点**判断——模型空间的"上"是由髋→肩构造出来的，恒为 +Y。
  const rawUp = new THREE.Vector3(
    (world[LM.lShoulder][0] + world[LM.rShoulder][0] - world[LM.lHip][0] - world[LM.rHip][0]) / 2,
    (world[LM.lShoulder][1] + world[LM.rShoulder][1] - world[LM.lHip][1] - world[LM.rHip][1]) / 2,
    (world[LM.lShoulder][2] + world[LM.rShoulder][2] - world[LM.lHip][2] - world[LM.rHip][2]) / 2,
  );
  const lying = rawUp.lengthSq() > 1e-8 && Math.abs(rawUp.normalize().y) < 0.5;

  return capturePose(humanoid, '图片生成', { source: 'mediapipe-pose', confidence, lying });
}




