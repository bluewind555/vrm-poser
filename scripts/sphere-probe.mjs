import fs from 'node:fs';
import { MMDParser } from 'mmd-parser';

const path = 'D:/DeepSeek Harness/vrm-poser/public/models/xun/浔.pmx';
const buf = fs.readFileSync(path);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const m = new MMDParser.Parser().parsePmx(ab, true);

console.log('material keys:', Object.keys(m.materials[0]).join(', '));
const sphereOf = (x) => x.envTextureIndex ?? x.sphereTextureIndex ?? -1;
const withSphere = m.materials.filter((x) => sphereOf(x) >= 0);
console.log('materials with sphere:', withSphere.length, '/', m.materials.length);
console.log(
  JSON.stringify(
    withSphere.slice(0, 8).map((x) => ({
      name: x.name,
      tex: x.textureIndex,
      sphere: sphereOf(x),
      mode: x.envFlag ?? x.sphereMode,
      toonFlag: x.toonFlag, toon: x.toonIndex,
    })),
    null,
    2,
  ),
);
console.log('textures:', m.textures.map((t, i) => `${i}:${t}`).join(' | '));

