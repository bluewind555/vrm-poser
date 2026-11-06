import fs from "node:fs";
import { MMDParser } from "mmd-parser";
const buf = fs.readFileSync("public/models/weilina/维琳娜6.pmx");
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const m = new MMDParser.Parser().parsePmx(ab, true);

const sum = m.materials.reduce((a, x) => a + x.faceCount, 0);
console.log({ faces: m.faces.length, facesX3: m.faces.length * 3, materialFaceSum: sum });

const v = m.vertices;
let maxEdge = 0, badTri = 0, oob = 0;
const worst = [];
for (let i = 0; i < m.faces.length; i++) {
  const f = m.faces[i].indices;
  for (const idx of f) if (idx < 0 || idx >= v.length) oob++;
  const p = f.map((k) => v[k].position);
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const d = Math.hypot(p[a][0]-p[b][0], p[a][1]-p[b][1], p[a][2]-p[b][2]);
    if (d > maxEdge) { maxEdge = d; if (worst.length < 5) worst.push({ i, d: +d.toFixed(2), f, p }); }
    if (d > 3) badTri++;
  }
}
console.log({ maxEdge: +maxEdge.toFixed(2), trianglesWithEdgeOver3: badTri, outOfRangeIndex: oob });
console.log("worst:", JSON.stringify(worst.slice(0,3)));

console.log("faces[0..5]:", JSON.stringify(m.faces.slice(0,6)));
console.log("vertex0 pos:", v[0].position, "vertex1 pos:", v[1].position);
