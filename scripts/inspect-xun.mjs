import fs from 'node:fs';
import { MMDParser } from 'mmd-parser';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const model = new MMDParser.Parser().parsePmx(ab, true);

console.log('textures:', model.textures.map((t, i) => `${i}:${t}`).join('\n          '));
console.log('\nmaterials:', model.materials.length);
const rows = model.materials.map((m, i) => ({
  i,
  name: m.name,
  tex: m.textureIndex,
  sph: m.sphereTextureIndex,
  mode: m.sphereMode,
  diffuse: m.diffuse.slice(0, 4).map((v) => +v.toFixed(2)),
  alpha: m.diffuse[3],
}));
for (const r of rows) {
  console.log(
    `${String(r.i).padStart(2)} ${r.name.padEnd(14)} tex=${String(r.tex).padStart(3)} sph=${String(r.sph).padStart(3)} mode=${r.mode} diffuse=${JSON.stringify(r.diffuse)}`,
  );
}
const noTex = rows.filter((r) => r.tex < 0).length;
const withSph = rows.filter((r) => r.sph >= 0).length;
console.log('\n无基础贴图材质:', noTex, '/ 有球面贴图材质:', withSph);
