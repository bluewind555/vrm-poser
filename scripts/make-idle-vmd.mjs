/**
 * 生成待机动作 VMD（自己创作，无第三方版权问题）。
 *
 * 难点：VMD 的骨名是 Shift-JIS，Node 没有内置编码器。
 * 这里反过来用 mmd-parser 自带的 s2uTable（SJIS → Unicode）建立反查表来编码。
 *
 * 用法：node scripts/make-idle-vmd.mjs
 * 产物：public/motions/idle-breathe.vmd / idle-sway.vmd
 */
import fs from 'node:fs';
import path from 'node:path';
import { CharsetEncoder } from 'mmd-parser';
const table = CharsetEncoder.prototype.s2uTable;

// SJIS 码 → 字符，反查成 字符 → SJIS 码
const charToSjis = new Map();
for (const [code, ch] of Object.entries(table)) {
  charToSjis.set(String.fromCharCode(ch), Number(code));
}

function encodeSjis(str, size) {
  const bytes = [];
  for (const ch of str) {
    const code = charToSjis.get(ch);
    if (code === undefined) throw new Error(`SJIS 里没有这个字符：${ch}`);
    if (code > 0xff) bytes.push((code >> 8) & 0xff, code & 0xff);
    else bytes.push(code);
  }
  if (bytes.length > size) throw new Error(`骨名太长：${str}`);
  const buf = Buffer.alloc(size);
  Buffer.from(bytes).copy(buf);
  return buf;
}

const FPS = 30;

/** 正弦关键帧：把一段循环动作写成 VMD */
function buildVmd(name, tracks, frames, step = 5) {
  const motions = [];
  for (const [boneName, fn] of Object.entries(tracks)) {
    for (let f = 0; f <= frames; f += step) {
      const t = f / frames; // 0..1 用于循环
      const { rx = 0, ry = 0, rz = 0, py = 0 } = fn(t * Math.PI * 2) ?? {};
      // q = qy * qx * qz（三个轴都要用上，之前漏了 rz，手臂放不下来）
      const qy = [Math.sin(ry / 2), Math.cos(ry / 2)];
      const qx = [Math.sin(rx / 2), Math.cos(rx / 2)];
      const qz = [Math.sin(rz / 2), Math.cos(rz / 2)];
      const mul = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
        a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
      ];
      const q = mul(mul([0, qy[0], 0, qy[1]], [qx[0], 0, 0, qx[1]]), [0, 0, qz[0], qz[1]]);
      motions.push({ boneName, frame: f, pos: [0, py, 0], rot: q });
    }
  }

  const parts = [];
  const magic = Buffer.alloc(30);
  magic.write('Vocaloid Motion Data 0002', 'latin1');
  parts.push(magic, encodeSjis(name, 20));

  const count = Buffer.alloc(4);
  count.writeUInt32LE(motions.length, 0);
  parts.push(count);

  for (const m of motions) {
    parts.push(encodeSjis(m.boneName, 15));
    const frame = Buffer.alloc(4);
    frame.writeUInt32LE(m.frame, 0);
    const pos = Buffer.alloc(12);
    pos.writeFloatLE(m.pos[0], 0);
    pos.writeFloatLE(m.pos[1], 4);
    pos.writeFloatLE(m.pos[2], 8);
    const rot = Buffer.alloc(16);
    rot.writeFloatLE(m.rot[0], 0);
    rot.writeFloatLE(m.rot[1], 4);
    rot.writeFloatLE(m.rot[2], 8);
    rot.writeFloatLE(m.rot[3], 12);
    parts.push(frame, pos, rot, Buffer.alloc(64));
  }

  // morph / camera 计数都为 0
  parts.push(Buffer.alloc(8));
  return { buffer: Buffer.concat(parts), count: motions.length, name };
}

const outDir = path.resolve('public/motions');
fs.mkdirSync(outDir, { recursive: true });

// ① 呼吸：胸腔起伏 + 头轻点 + 手臂微摆（4 秒）
const breathe = buildVmd(
  'idle-breathe',
  {
    上半身: (a) => ({ rx: Math.sin(a) * 0.012 }),
    上半身2: (a) => ({ rx: Math.sin(a) * 0.02 }),
    首: (a) => ({ rx: Math.sin(a * 0.5 + 0.6) * 0.012, ry: Math.sin(a * 0.35) * 0.02 }),
    // 手臂要显式放下：MMD 的手臂 rest 是 T-pose（水平），不给角度就会摊成十字
    左腕: (a) => ({ rz: -0.80 + Math.sin(a) * 0.03 }),
    右腕: (a) => ({ rz: 0.80 - Math.sin(a) * 0.03 }),
    左ひじ: (a) => ({ rz: -0.08 + Math.sin(a) * 0.02 }),
    右ひじ: (a) => ({ rz: 0.08 - Math.sin(a) * 0.02 }),
  },
  120,
  5,
);
fs.writeFileSync(path.join(outDir, 'idle-breathe.vmd'), breathe.buffer);

// ② 轻晃：重心左右移动 + 上身反向摆（5 秒）
const sway = buildVmd(
  'idle-sway',
  {
    センター: (a) => ({ py: Math.sin(a) * 0.6 }),
    下半身: (a) => ({ rz: Math.sin(a) * 0.02 }),
    上半身: (a) => ({ rz: -Math.sin(a) * 0.02, ry: Math.sin(a * 0.5) * 0.03 }),
    首: (a) => ({ ry: Math.sin(a * 0.5) * 0.02 }),
    左腕: (a) => ({ rz: -0.80 + Math.sin(a) * 0.04 }),
    右腕: (a) => ({ rz: 0.80 - Math.sin(a) * 0.04 }),
    左ひじ: (a) => ({ rz: -0.08 }),
    右ひじ: (a) => ({ rz: 0.08 }),
  },
  150,
  5,
);
fs.writeFileSync(path.join(outDir, 'idle-sway.vmd'), sway.buffer);

console.log('生成完成：');
for (const [f, v] of [
  ['idle-breathe.vmd', breathe],
  ['idle-sway.vmd', sway],
]) {
  console.log(`  ${f}  ${v.count} 个关键帧  ${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(1)} KB`);
}


