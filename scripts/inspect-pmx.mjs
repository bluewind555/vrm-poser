// 只解析 PMX 头部 + 顶点统计 + 贴图 + 材质 + 骨骼名，用于确认格式与骨骼映射
import fs from 'node:fs';

const file = process.argv[2];
const buf = fs.readFileSync(file);
let p = 0;

const sig = buf.toString('ascii', 0, 4);
if (sig !== 'PMX ') throw new Error('not PMX: ' + JSON.stringify(sig));
p = 4;
const version = buf.readFloatLE(p);
p += 4;
// PMX 2.0 规范：header size 是 1 字节（不是 int32），后面紧跟 globals
const headerSize = buf.readUInt8(p);
p += 1;
const gStart = p;
const encoding = buf.readUInt8(gStart);
const additionalUV = buf.readUInt8(gStart + 1);
const vertexIndexSize = buf.readUInt8(gStart + 2);
const textureIndexSize = buf.readUInt8(gStart + 3);
const materialIndexSize = buf.readUInt8(gStart + 4);
const boneIndexSize = buf.readUInt8(gStart + 5);
const morphIndexSize = buf.readUInt8(gStart + 6);
const rigidBodyIndexSize = buf.readUInt8(gStart + 7);
p += headerSize;

const readText = () => {
  const len = buf.readInt32LE(p);
  p += 4;
  const raw = buf.subarray(p, p + len);
  p += len;
  return raw.toString(encoding === 0 ? 'utf16le' : 'utf8');
};
const readIndex = (size) => {
  let v;
  if (size === 1) { v = buf.readInt8(p); }
  else if (size === 2) { v = buf.readInt16LE(p); }
  else { v = buf.readInt32LE(p); }
  p += size;
  return v;
};
const skipUV = () => { p += 2 * 4 + additionalUV * 4 * 4; };

const name = readText();
const nameEn = readText();
readText(); // comment
readText(); // comment en

const vertexCount = buf.readInt32LE(p); p += 4;
const weightTypes = new Map();
for (let i = 0; i < vertexCount; i++) {
  p += 12; // pos
  p += 12; // normal
  skipUV();
  const wt = buf.readUInt8(p); p += 1;
  weightTypes.set(wt, (weightTypes.get(wt) || 0) + 1);
  if (wt === 0) p += boneIndexSize;
  else if (wt === 1) p += boneIndexSize * 2 + 4;
  else if (wt === 2) p += boneIndexSize * 4 + 16;
  else if (wt === 3) p += boneIndexSize * 2 + 4 + 36;
  else if (wt === 4) p += boneIndexSize * 4 + 16;
  else throw new Error('unknown weight type ' + wt);
  p += 4; // edge scale
}

const faceCount = buf.readInt32LE(p); p += 4;
p += faceCount * vertexIndexSize;

const textureCount = buf.readInt32LE(p); p += 4;
const textures = [];
for (let i = 0; i < textureCount; i++) textures.push(readText());

const materialCount = buf.readInt32LE(p); p += 4;
const materials = [];
for (let i = 0; i < materialCount; i++) {
  const mName = readText(); readText();
  p += 16 + 12 + 4 + 12; // diffuse, specular, specularity, ambient
  const flag = buf.readUInt8(p); p += 1;
  p += 16 + 4; // edge color + size
  const texIdx = readIndex(textureIndexSize);
  const sphIdx = readIndex(textureIndexSize);
  const sphMode = buf.readUInt8(p); p += 1;
  const toonFlag = buf.readUInt8(p); p += 1;
  if (toonFlag === 0) readIndex(textureIndexSize); else p += 1;
  readText(); // memo
  const surfaceCount = buf.readInt32LE(p); p += 4;
  materials.push({ name: mName, texIdx, sphIdx, flag, surfaceCount });
}

const boneCount = buf.readInt32LE(p); p += 4;
const bones = [];
for (let i = 0; i < boneCount; i++) {
  const bName = readText(); readText();
  const pos = [buf.readFloatLE(p), buf.readFloatLE(p + 4), buf.readFloatLE(p + 8)];
  p += 12;
  const parent = readIndex(boneIndexSize);
  p += 4; // layer
  const flags = buf.readUInt16LE(p); p += 2;
  if (flags & 0x0001) readIndex(boneIndexSize);
  if (flags & 0x0100) { readIndex(boneIndexSize); p += 4; }
  if (flags & 0x0200) p += 12;
  if (flags & 0x0400) p += 24;
  if (flags & 0x0800) p += 4;
  if (flags & 0x0020) {
    readIndex(boneIndexSize);
    p += 4 + 4;
    const linkCount = buf.readInt32LE(p); p += 4;
    const hasLimit = buf.readUInt8(p); p += 1;
    p += linkCount * (boneIndexSize + (hasLimit ? 24 : 0));
  }
  bones.push({ name: bName, parent, pos });
}

console.log(JSON.stringify({
  version,
  encoding: encoding === 0 ? 'utf16' : 'utf8',
  additionalUV,
  indexSizes: { vertex: vertexIndexSize, texture: textureIndexSize, material: materialIndexSize, bone: boneIndexSize, morph: morphIndexSize, rigid: rigidBodyIndexSize },
  name,
  nameEn,
  vertexCount,
  faceCount: faceCount / 3,
  weightTypes: [...weightTypes.entries()],
  textures,
  materials: materials.map((m) => `${m.name} (tex ${m.texIdx}, ${m.surfaceCount / 3} tris)`),
  boneCount,
  bones: bones.map((b, i) => `${i}:${b.name}<-${b.parent}`),
}, null, 2));
