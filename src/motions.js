import * as THREE from 'three';

/**
 * 程序化待机动作。
 *
 * 为什么不直接发 .vmd 文件：VMD 的骨名是 Shift-JIS 编码，浏览器和 Node 都没有内置
 * 编码能力，我们没法"自己生成"一个合法的动作文件；而网上现成的动作大多带
 * "禁止二次配布"的条款，不适合随代码分发。所以这里用纯程序化动作兜底，
 * 外部 .vmd 则由用户自己加载。
 *
 * 这些动作用**代理骨骼（VRM 空间）**驱动，和姿势系统、视线跟随都兼容。
 */

const TAU = Math.PI * 2;

class MotionBase {
  constructor(name, expressions = []) {
    this.name = name;
    /** 动作自带的情绪表情（候选名，按顺序找第一个存在的） */
    this.expressions = expressions;
    this.time = 0;
    this.speed = 1;
    this.playing = true;
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
  /** 子类实现：给定时间，返回要设置的骨骼姿态 */
  pose() {
    return {};
  }
  update(dt, avatar) {
    if (!this.playing) return true;
    this.time += dt * this.speed;
    const humanoid = avatar?.humanoid;
    if (!humanoid) return false;
    const set = (key, rx, ry, rz) => {
      const node = humanoid.getNormalizedBoneNode?.(key);
      if (node) node.rotation.set(rx, ry, rz);
    };
    for (const [key, rot] of Object.entries(this.pose(this.time))) {
      set(key, rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0);
    }
    return true;
  }
}

/** 呼吸：胸腔起伏 + 肩膀微动 + 头轻晃 */
export class BreathMotion extends MotionBase {
  constructor() {
    super('呼吸待机', []);
  }
  pose(t) {
    const breath = Math.sin(t * 1.7);
    return {
      chest: [breath * 0.02, 0, 0],
      spine: [0, Math.sin(t * 0.5) * 0.01, 0],
      neck: [Math.sin(t * 0.6 + 0.6) * 0.012, Math.sin(t * 0.35) * 0.02, 0],
      leftUpperArm: [0, Math.sin(t * 0.45) * 0.02, 0],
      rightUpperArm: [0, -Math.sin(t * 0.45) * 0.02, 0],
    };
  }
}

/** 轻晃：整体左右重心移动 + 手臂自然摆动 */
export class SwayMotion extends MotionBase {
  constructor() {
    super('轻晃', ['にっこり', '笑い']);
  }
  pose(t) {
    const s = Math.sin(t * 0.9);
    return {
      hips: [0, s * 0.02, Math.sin(t * 0.9 + 0.4) * 0.02],
      spine: [0, -s * 0.02, s * 0.015],
      chest: [s * 0.008, -s * 0.01, s * 0.01],
      neck: [0, s * 0.02, -s * 0.01],
      leftUpperArm: [0, s * 0.03, 0.02],
      rightUpperArm: [0, s * 0.03, -0.02],
      leftUpperLeg: [0, 0, -s * 0.01],
      rightUpperLeg: [0, 0, -s * 0.01],
    };
  }
}

/** 挥手：抬右手，前臂来回摆，头微微侧 */
export class WaveMotion extends MotionBase {
  constructor() {
    super('挥手', ['にっこり', '笑い', '喜び']);
    this.duration = 4;
  }
  pose(t) {
    const phase = (t % 4) / 4; // 0..1
    // 抬起（0~15%），挥动（15~85%），放下（85~100%）
    const lift = phase < 0.15 ? phase / 0.15 : phase > 0.85 ? (1 - phase) / 0.15 : 1;
    const wave = Math.sin((t % 4) * TAU * 1.6) * 0.35 * lift;
    return {
      rightUpperArm: [0, -2.25 * lift, -0.35 * lift],
      rightLowerArm: [wave, 0, -0.5 * lift],
      rightHand: [0, wave * 0.6, 0],
      neck: [0, -0.12 * lift, 0.05 * lift],
      spine: [0, -0.05 * lift, 0],
    };
  }
}

export function createMotion(kind) {
  if (kind === 'sway') return new SwayMotion();
  if (kind === 'wave') return new WaveMotion();
  return new BreathMotion();
}

