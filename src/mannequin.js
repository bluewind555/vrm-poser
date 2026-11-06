import * as THREE from 'three';
import { BONE_NAMES } from './pose.js';

/**
 * 程序化人偶：在还没有 VRM 模型时用来验证姿势管线。
 * 它暴露和 three-vrm 的 VRMHumanoid 一样的最小接口：
 *   humanoid.getNormalizedBoneNode(name) -> Object3D | null
 *   humanoid.autoUpdateHumanBones = bool
 * 所以 pose.js 一行都不用改就能驱动它。
 */
export function createMannequin() {
  const root = new THREE.Group();
  root.name = 'Mannequin';

  const nodes = new Map();
  const skin = new THREE.MeshStandardMaterial({ color: 0x93a6bd, roughness: 0.62, metalness: 0.04 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd8a24a, roughness: 0.45, metalness: 0.1 });

  const bone = (name, parent, [x, y, z]) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    (parent || root).add(g);
    nodes.set(name, g);
    return g;
  };

  const hips = bone('hips', root, [0, 0.95, 0]);
  const spine = bone('spine', hips, [0, 0.1, 0]);
  const chest = bone('chest', spine, [0, 0.14, 0]);
  const upperChest = bone('upperChest', chest, [0, 0.12, 0]);
  const neck = bone('neck', upperChest, [0, 0.1, 0]);
  const head = bone('head', neck, [0, 0.09, 0]);

  const arm = (side, sx) => {
    const shoulder = bone(`${side}Shoulder`, upperChest, [sx * 0.045, 0.05, 0]);
    const upperArm = bone(`${side}UpperArm`, shoulder, [sx * 0.085, 0, 0]);
    const lowerArm = bone(`${side}LowerArm`, upperArm, [sx * 0.26, 0, 0]);
    const hand = bone(`${side}Hand`, lowerArm, [sx * 0.24, 0, 0]);
    return { shoulder, upperArm, lowerArm, hand };
  };
  const armL = arm('left', 1);
  const armR = arm('right', -1);

  const leg = (side, sx) => {
    const upperLeg = bone(`${side}UpperLeg`, hips, [sx * 0.09, -0.06, 0]);
    const lowerLeg = bone(`${side}LowerLeg`, upperLeg, [0, -0.42, 0]);
    const foot = bone(`${side}Foot`, lowerLeg, [0, -0.42, 0]);
    const toes = bone(`${side}Toes`, foot, [0, -0.03, 0.1]);
    return { upperLeg, lowerLeg, foot, toes };
  };
  const legL = leg('left', 1);
  const legR = leg('right', -1);

  /** 从 parent 原点朝 dir 方向拉一根胶囊，长度 len */
  const segment = (parent, dir, len, radius, material = skin) => {
    const d = new THREE.Vector3(...dir).normalize();
    const geo = new THREE.CapsuleGeometry(radius, Math.max(len - radius * 2, 0.02), 4, 12);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(d.clone().multiplyScalar(len / 2));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // 躯干
  segment(hips, [0, 0.12, 0], 0.2, 0.105, accent);
  segment(spine, [0, 0.13, 0], 0.2, 0.098);
  segment(chest, [0, 0.12, 0], 0.2, 0.094);
  segment(upperChest, [0, 0.1, 0], 0.15, 0.082);
  segment(neck, [0, 0.1, 0], 0.12, 0.045);

  // 头
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), skin);
  headMesh.position.set(0, 0.085, 0);
  headMesh.castShadow = true;
  head.add(headMesh);

  // 手臂（T-pose，沿 ±X 展开）
  for (const [a, sx] of [[armL, 1], [armR, -1]]) {
    segment(a.upperArm, [sx, 0, 0], 0.26, 0.045);
    segment(a.lowerArm, [sx, 0, 0], 0.24, 0.038);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.075), skin);
    palm.position.set(sx * 0.05, 0, 0);
    palm.castShadow = true;
    a.hand.add(palm);
  }

  // 腿
  for (const l of [legL, legR]) {
    segment(l.upperLeg, [0, -0.42, 0], 0.42, 0.062);
    segment(l.lowerLeg, [0, -0.42, 0], 0.42, 0.05);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.2), accent);
    foot.position.set(0, -0.025, 0.055);
    foot.castShadow = true;
    foot.receiveShadow = true;
    l.foot.add(foot);
  }

  const humanoid = {
    autoUpdateHumanBones: true,
    getNormalizedBoneNode: (name) => nodes.get(name) || null,
    update: () => {},
  };

  return {
    kind: 'mannequin',
    label: '程序化人偶（占位）',
    root,
    humanoid,
    bones: BONE_NAMES.filter((n) => nodes.has(n)),
    update() {},
    dispose() {
      root.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
        }
      });
      skin.dispose();
      accent.dispose();
    },
  };
}
