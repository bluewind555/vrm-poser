import { MMDParser } from 'mmd-parser';

/**
 * 纯解析层：PMX 二进制 → 可直接塞进 BufferGeometry 的 TypedArray。
 * 刻意不依赖 three、不碰 DOM，所以能整段放进 Web Worker 跑。
 *
 * 注意两个坑（都在下面处理了）：
 *  1. MMD 单位约 1/8 米，缩放必须烘进顶点坐标 —— 不能靠父级 scale，否则蒙皮会被二次缩放；
 *  2. PMX 里骨骼索引 -1 表示"无骨骼"，直接塞进 Uint16 会变成 65535，把顶点甩到原点。
 */
export function parsePmxToBuffers(arrayBuffer) {
  const model = new MMDParser.Parser().parsePmx(arrayBuffer, true);

  const vCount = model.vertices.length;
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const skinIndices = new Uint16Array(vCount * 4);
  const skinWeights = new Float32Array(vCount * 4);

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vCount; i++) {
    const y = model.vertices[i].position[1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const rawHeight = maxY - minY;
  const scale = rawHeight > 1 ? 1.6 / rawHeight : 1;

  const boneCount = model.bones.length;
  let badIndex = 0;
  for (let i = 0; i < vCount; i++) {
    const v = model.vertices[i];
    positions[i * 3] = v.position[0] * scale;
    positions[i * 3 + 1] = v.position[1] * scale;
    positions[i * 3 + 2] = v.position[2] * scale;
    normals[i * 3] = v.normal[0];
    normals[i * 3 + 1] = v.normal[1];
    normals[i * 3 + 2] = v.normal[2];
    uvs[i * 2] = v.uv[0];
    uvs[i * 2 + 1] = v.uv[1];

    const si = v.skinIndices || [0, 0, 0, 0];
    const sw = v.skinWeights || [1, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const idx = si[k] ?? 0;
      if (idx < 0 || idx >= boneCount) {
        skinIndices[i * 4 + k] = 0;
        if (idx !== 0) badIndex += 1;
      } else {
        skinIndices[i * 4 + k] = idx;
      }
      skinWeights[i * 4 + k] = sw[k] ?? 0;
    }
  }

  const index = new Uint32Array(model.faces.length * 3);
  for (let i = 0; i < model.faces.length; i++) {
    const f = model.faces[i].indices;
    index[i * 3] = f[0];
    index[i * 3 + 1] = f[1];
    index[i * 3 + 2] = f[2];
  }

  return {
    positions,
    normals,
    uvs,
    skinIndices,
    skinWeights,
    index,
    scale,
    rawHeight,
    minY,
    maxY,
    badIndex,
    counts: {
      vertices: vCount,
      triangles: model.faces.length,
      materials: model.materials.length,
      bones: boneCount,
      textures: model.textures.length,
    },
    materials: model.materials.map((m) => ({
      name: m.name,
      englishName: m.englishName,
      diffuse: m.diffuse,
      specular: m.specular,
      shininess: m.shininess,
      ambient: m.ambient,
      flag: m.flag,
      edgeColor: m.edgeColor,
      edgeSize: m.edgeSize,
      textureIndex: m.textureIndex,
      // 球面贴图（SPH/SPA）：envTextureIndex 指向 data.textures，envFlag 是混合模式
      // 0=关闭 1=乘 2=加 3=SPA(用 alpha 叠层)
      envTextureIndex: m.envTextureIndex,
      envFlag: m.envFlag,
      // 内置 toon：toonFlag=0 时 toonIndex 指向贴图列表，=1 时是内置梯度编号
      toonFlag: m.toonFlag,
      toonIndex: m.toonIndex,
      faceCount: m.faceCount,
    })),
    bones: model.bones.map((b) => ({
      name: b.name,
      parentIndex: b.parentIndex,
      position: b.position,
    })),
    textures: model.textures.slice(),
    // 表情（morph）：只保留顶点型(1)和组型(0)，其余类型（骨骼/UV/材质）暂不支持。
    // 顶点偏移量同样要乘 scale。
    morphs: (model.morphs ?? [])
      .map((m, idx) => {
        if (m.type === 1) {
          return {
            index: idx,
            name: m.name,
            englishName: m.englishName,
            panel: m.panel,
            type: 1,
            vertexIndices: m.elements.map((e) => e.index),
            offsets: m.elements.map((e) => [e.position[0] * scale, e.position[1] * scale, e.position[2] * scale]),
          };
        }
        if (m.type === 0) {
          return {
            index: idx,
            name: m.name,
            englishName: m.englishName,
            panel: m.panel,
            type: 0,
            group: m.elements.map((e) => ({ index: e.index, ratio: e.ratio })),
          };
        }
        return null;
      })
      .filter(Boolean),
  };
}

/** Worker 消息里可以零拷贝转移的 buffer 列表 */
export function transferablesOf(data) {
  return [data.positions.buffer, data.normals.buffer, data.uvs.buffer, data.skinIndices.buffer, data.skinWeights.buffer, data.index.buffer];
}
