import fs from 'node:fs';
import * as mmdmodule from 'mmd-parser';

const buf = fs.readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

console.log('module keys:', Object.keys(mmdmodule).join(', '));
const MMDParser = mmdmodule.MMDParser || mmdmodule;
const parser = new MMDParser.Parser();
const model = parser.parsePmx(ab, true);

console.log('top keys:', Object.keys(model).join(', '));
for (const k of Object.keys(model)) {
  const v = model[k];
  if (Array.isArray(v)) {
    console.log(`  ${k}: array(${v.length}) first=${JSON.stringify(v[0])?.slice(0, 220)}`);
  } else if (v && typeof v === 'object' && v.length !== undefined) {
    console.log(`  ${k}: typedarray(${v.length}) ${v.constructor.name}`);
  } else {
    console.log(`  ${k}:`, JSON.stringify(v).slice(0, 320));
  }
}

if (model.bones) {
  console.log('\n--- bones ---');
  model.bones.forEach((b, i) => console.log(`${i}\t${b.name}\t parent=${b.parentIndex}`));
}
if (model.materials) {
  console.log('\n--- materials ---');
  model.materials.forEach((m, i) =>
    console.log(`${i}\t${m.name}\t tex=${m.textureIndex} flag=${m.flag ?? m.flags} tris=${(m.faceCount ?? 0) / 3}`),
  );
}
