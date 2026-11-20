import { Parser } from 'mmd-parser';
import * as THREE from 'three';

/**
 * VMD 动作播放。
 *
 * 关键点：VMD 是 **MMD 坐标空间**的骨骼旋转，直接套到 humanoid 代理节点（VRM 空间）会错轴。
 * 所以这里直接驱动 PMX 的真实骨骼（按日文名索引），并在播放期间让 loader 跳过 retarget
 * （`avatar.setExternalPose(true)`），否则每帧都会被姿势系统覆盖。
 */

const FPS = 30;
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/**
 * 只有位移骨骼的 VMD position 才有意义；其余骨骼的 position 在 VMD 里恒为 0，
 * 而 three.js 的 bone.position 就是**静止偏移**——盲写会把整个骨架塌掉。
 */
const POSITION_BONES = new Set(['センター', 'センター2', 'グルーブ', '腰', '全ての親']);

export class VmdPlayer {
  constructor(vmd, { loop = true, speed = 1 } = {}) {
    this.tracks = new Map(); // boneName -> [{ frame, pos, rot }]
    this.morphTracks = new Map();
    this.loop = loop;
    this.speed = speed;
    this.time = 0;
    this.playing = false;
    this.name = vmd?.metadata?.name ?? '';
    /** 存进姿势用：kind + id（内置动作是 URL，用户上传的是文件名，重启后不可恢复） */
    this.motionKind = 'vmd';
    this.motionId = '';
    this.maxFrame = 0;

    for (const m of vmd?.motions ?? []) {
      const t = this.tracks.get(m.boneName) ?? [];
      t.push({
        frame: m.frameNum,
        pos: [m.position[0], m.position[1], m.position[2]],
        rot: [m.rotation[0], m.rotation[1], m.rotation[2], m.rotation[3]],
      });
      this.tracks.set(m.boneName, t);
      if (m.frameNum > this.maxFrame) this.maxFrame = m.frameNum;
    }
    for (const t of this.tracks.values()) t.sort((a, b) => a.frame - b.frame);

    for (const m of vmd?.morphs ?? []) {
      const t = this.morphTracks.get(m.morphName) ?? [];
      t.push({ frame: m.frameNum, weight: m.weight });
      this.morphTracks.set(m.morphName, t);
      if (m.frameNum > this.maxFrame) this.maxFrame = m.frameNum;
    }
    for (const t of this.morphTracks.values()) t.sort((a, b) => a.frame - b.frame);

    this.duration = this.maxFrame / FPS;
  }

  play() {
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  stop() {
    this.playing = false;
    this.time = 0;
  }
  seek(sec) {
    this.time = Math.max(0, Math.min(sec, this.duration));
  }

  /** 采样某根骨骼在给定帧的姿态 */
  sampleBone(track, frame) {
    const n = track.length;
    if (!n) return null;
    if (n === 1 || frame <= track[0].frame) return track[0];
    const last = track[n - 1];
    if (frame >= last.frame) return last;
    // 二分找区间
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (track[mid].frame <= frame) lo = mid;
      else hi = mid;
    }
    const a = track[lo];
    const b = track[hi];
    const span = b.frame - a.frame || 1;
    const t = (frame - a.frame) / span;
    return { a, b, t };
  }

  /**
   * 应用到真实骨骼。
   *
   * MMD 语义：没被动作覆盖的骨骼回到 rest 姿态。
   * 另外 VMD 的 position 是**位移偏移**，不是绝对坐标——センター 的 rest 位置是
   * (0, 0.83, 0)，直接覆盖会让整个身体沉到地板下（实测塌 0.8 米，看起来像"腿折了"）。
   */
  apply(avatar) {
    if (!avatar?.bones) return;
    avatar.setExternalPose?.(true);

    // 第一次播放时记录 rest 姿态
    if (!this.rest) {
      this.rest = new Map();
      for (const [name, bone] of avatar.bones) {
        this.rest.set(name, { q: bone.quaternion.clone(), p: bone.position.clone() });
      }
    }

    // 全部回 rest，再叠动作
    for (const [name, bone] of avatar.bones) {
      const rest = this.rest.get(name);
      if (!rest) continue;
      bone.quaternion.copy(rest.q);
      bone.position.copy(rest.p);
    }

    const frame = (this.time * FPS) % Math.max(this.maxFrame + 1, 1);
    const k = avatar.scale ?? 1;

    for (const [boneName, track] of this.tracks) {
      const bone = avatar.bones.get(boneName);
      if (!bone) continue;
      const rest = this.rest.get(boneName);
      const s = this.sampleBone(track, frame);
      if (!s) continue;

      if (s.a) {
        _qa.set(s.a.rot[0], s.a.rot[1], s.a.rot[2], s.a.rot[3]);
        _qb.set(s.b.rot[0], s.b.rot[1], s.b.rot[2], s.b.rot[3]);
        _q.slerpQuaternions(_qa, _qb, s.t);
        bone.quaternion.copy(_q);
        if (POSITION_BONES.has(boneName) && rest) {
          bone.position.set(
            rest.p.x + (s.a.pos[0] + (s.b.pos[0] - s.a.pos[0]) * s.t) * k,
            rest.p.y + (s.a.pos[1] + (s.b.pos[1] - s.a.pos[1]) * s.t) * k,
            rest.p.z + (s.a.pos[2] + (s.b.pos[2] - s.a.pos[2]) * s.t) * k,
          );
        }
      } else {
        const r = s.rot ?? s.b.rot;
        bone.quaternion.set(r[0], r[1], r[2], r[3]);
        if (POSITION_BONES.has(boneName) && s.pos && rest) {
          bone.position.set(rest.p.x + s.pos[0] * k, rest.p.y + s.pos[1] * k, rest.p.z + s.pos[2] * k);
        }
      }
    }
    avatar.root.updateMatrixWorld(true);
  }

  update(dt, avatar) {
    if (!this.playing || !this.duration) return false;
    this.time += dt * this.speed;
    if (this.time > this.duration) {
      if (this.loop) this.time %= this.duration || 1;
      else {
        this.time = this.duration;
        this.playing = false;
      }
    }
    this.apply(avatar);
    return true;
  }
}

/** 从 ArrayBuffer 解析 VMD */
export function parseVmdBuffer(buffer) {
  const parser = new Parser();
  // 关键：**不要**做 leftToRight 转换。
  // pmx-loader 建的骨骼保留 MMD 坐标系（retarget 用父骨世界四元数在同一坐标系里算），
  // 所以 VMD 的原始四元数正好能直接写进 bone.quaternion。
  // 一旦转成右手系，旋转轴会整体错 ~90°，模型会折叠成一团。
  const vmd = parser.parseVmd(buffer, false);
  return new VmdPlayer(vmd);
}

/**
 * 内置"呼吸待机"：不依赖任何外部文件，纯程序化。
 * 用代理骨骼（VRM 空间）驱动，不需要 externalPose，和姿势系统兼容。
 */
export class IdleBreathing {
  constructor() {
    this.time = 0;
    this.playing = true;
    this.speed = 1;
    this.name = '呼吸待机（内置）';
    this.duration = Infinity;
  }

  update(dt, avatar) {
    if (!this.playing) return false;
    this.time += dt * this.speed;
    const t = this.time;
    const humanoid = avatar?.humanoid;
    if (!humanoid) return false;

    const set = (name, rx, ry, rz) => {
      const node = humanoid.getNormalizedBoneNode?.(name);
      if (!node) return;
      node.rotation.set(rx, ry, rz);
    };

    // 呼吸：胸腔起伏 + 肩膀轻微上下
    const breath = Math.sin(t * 1.6);
    set('chest', breath * 0.018, 0, 0);
    set('spine', Math.sin(t * 0.8) * 0.006, Math.sin(t * 0.45) * 0.012, 0);
    // 头微微晃动
    set('neck', Math.sin(t * 0.6 + 0.7) * 0.012, Math.sin(t * 0.37) * 0.02, 0);
    // 手臂自然微摆
    set('leftUpperArm', 0, Math.sin(t * 0.5) * 0.02, 0);
    set('rightUpperArm', 0, -Math.sin(t * 0.5) * 0.02, 0);
    return true;
  }
}
