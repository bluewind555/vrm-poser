import fs from "node:fs";
import { MMDParser } from "mmd-parser";
const buf = fs.readFileSync("public/models/weilina/维琳娜6.pmx");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const m = new MMDParser.Parser().parsePmx(ab, true);

let badW = 0, badI = 0, minSum = 9, maxSum = -9, zeroW = 0;
const samples = [];
for (let i = 0; i < m.vertices.length; i++) {
  const v = m.vertices[i];
  const w = v.skinWeights || [];
  const s = w.reduce((a, b) => a + b, 0);
  minSum = Math.min(minSum, s); maxSum = Math.max(maxSum, s);
  if (Math.abs(s - 1) > 0.01) { badW++; if (samples.length < 3) samples.push({ i, w: Array.from(w), s, si: Array.from(v.skinIndices || []) }); }
  if (s < 1e-6) zeroW++;
  for (const idx of v.skinIndices || []) if (idx < 0 || idx >= m.bones.length) badI++;
}
console.log({ vertices: m.vertices.length, badWeightSum: badW, zeroWeight: zeroW, badIndex: badI, minSum, maxSum });
console.log("samples:", JSON.stringify(samples));

// 顶点 y 范围
let minY = Infinity, maxY = -Infinity;
for (const v of m.vertices) { minY = Math.min(minY, v.position[1]); maxY = Math.max(maxY, v.position[1]); }
console.log({ minY, maxY, height: maxY - minY });

// 关键骨骼位置
const names = ["下半身","上半身","上半身2","首","頭","左腕","左ひじ","左手首","左足","左ひざ","左足首","左つま先","右腕","右足"];
for (const n of names) {
  const i = m.bones.findIndex(b => b.name === n);
  console.log(n, i, i >= 0 ? m.bones[i].position.map(x => +x.toFixed(2)) : "");
}
