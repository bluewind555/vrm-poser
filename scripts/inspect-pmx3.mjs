import fs from 'node:fs';
import { MMDParser } from 'mmd-parser';

const buf = fs.readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const model = new MMDParser.Parser().parsePmx(ab, true);

console.log('--- vertex[0] keys ---');
console.log(JSON.stringify(model.vertices[0], null, 2).slice(0, 900));

const wt = new Map();
for (const v of model.vertices) wt.set(v.weightType ?? '?', (wt.get(v.weightType ?? '?') ?? 0) + 1);
console.log('weight types:', JSON.stringify([...wt]));

console.log('--- materials ---');
let sum = 0;
model.materials.forEach((m, i) => {
  sum += m.faceCount;
  console.log(`${i}\t${m.name}\ttex=${m.textureIndex}\tflag=${m.flag}\tfaceCount=${m.faceCount}\tdiffuse=${m.diffuse.slice(0, 4)}`);
});
console.log('sum faceCount =', sum, '| faces.length*3 =', model.faces.length * 3);

console.log('--- bones 55..130 ---');
model.bones.slice(55, 130).forEach((b, i) => console.log(`${i + 55}\t${b.name}\tparent=${b.parentIndex}`));

console.log('--- bbox ---');
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
for (const v of model.vertices) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], v.position[k]);
    max[k] = Math.max(max[k], v.position[k]);
  }
}
console.log('min', min.map((n) => n.toFixed(2)), 'max', max.map((n) => n.toFixed(2)));
console.log('textures:', model.textures.join(' | '));
