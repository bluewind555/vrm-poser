import fs from "node:fs";
import { MMDParser } from "mmd-parser";
const buf = fs.readFileSync("D:/DeepSeek Harness/vrm-poser/public/models/xun/浔.pmx");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const m = new MMDParser.Parser().parsePmx(ab, true);
const sizes = new Map();
const colors = new Map();
for (const x of m.materials) {
  const s = x.edgeSize ?? 0;
  sizes.set(s, (sizes.get(s) ?? 0) + 1);
  const c = (x.edgeColor ?? [0,0,0]).map((v) => +v.toFixed(2)).join(",");
  colors.set(c, (colors.get(c) ?? 0) + 1);
}
console.log("edgeSize 分布:", [...sizes.entries()].sort((a,b)=>a[0]-b[0]));
console.log("edgeColor 分布:", [...colors.entries()].slice(0, 6));
