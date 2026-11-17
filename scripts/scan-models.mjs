import fs from 'node:fs';
import path from 'node:path';

/**
 * 扫描 public/models/*，生成模型库索引。
 *
 * 规则：
 * - 每个子目录算一个模型（跳过 batch / posedata / mediapipe 这类素材目录）
 * - 目录里有 model.json 就用它（手写元数据优先）
 * - 没有就按目录名/文件名猜：游戏、角色名
 * - 取目录里最大的 .pmx（配件通常比本体小），没有 pmx 再找 .vrm/.glb
 */

const ROOT = path.resolve('public/models');
const SKIP_DIRS = new Set(['batch', 'posedata', 'mediapipe']);

const GAME_RULES = [
  [/原神|genshin|yuan.?shen/i, '原神'],
  [/绝区零|zenless|zzz|zero.?zone/i, '绝区零'],
  [/星穹|star.?rail|hsr/i, '崩坏：星穹铁道'],
  [/崩坏3|honkai.?3|bh3/i, '崩坏3'],
  [/鸣潮|wuthering|wuwa/i, '鸣潮'],
  [/异环|neverness|nte/i, '异环'],
  [/战双|punishing|pgr/i, '战双帕弥什'],
  [/明日方舟|arknights/i, '明日方舟'],
];

function guessGame(text) {
  for (const [re, name] of GAME_RULES) if (re.test(text)) return name;
  return '未分类';
}

/** 目录名 → 角色名：去掉 `_by_作者`、纯数字后缀等 */
function guessCharacter(dirName) {
  let name = dirName;
  name = name.replace(/[_\-\s]*by[_\-\s].*$/i, '');
  name = name.replace(/[_\-\s]+\d+$/, '');
  name = name.replace(/^【[^】]*】/, '').trim();
  return name || dirName;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pickModelFile(dirAbs, dirName) {
  const files = fs.readdirSync(dirAbs);
  const pmx = files.filter((f) => f.toLowerCase().endsWith('.pmx'));
  if (pmx.length) {
    const withSize = pmx.map((f) => ({ f, size: fs.statSync(path.join(dirAbs, f)).size }));
    withSize.sort((a, b) => b.size - a.size);
    return { file: withSize[0].f, kind: 'pmx', size: withSize[0].size };
  }
  const other = files.find((f) => /\.(vrm|glb)$/i.test(f));
  if (other) return { file: other, kind: other.toLowerCase().endsWith('.vrm') ? 'vrm' : 'glb', size: fs.statSync(path.join(dirAbs, other)).size };
  return null;
}

if (!fs.existsSync(ROOT)) {
  console.error('找不到 public/models 目录');
  process.exit(1);
}

const models = [];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dirName = entry.name;
  if (SKIP_DIRS.has(dirName)) continue;

  const dirAbs = path.join(ROOT, dirName);
  const picked = pickModelFile(dirAbs, dirName);
  if (!picked) continue;

  const metaFile = path.join(dirAbs, 'model.json');
  const meta = readJson(metaFile) ?? {};
  const guessChar = guessCharacter(dirName);
  const game = meta.game ?? guessGame(`${dirName} ${picked.file}`);
  const character = meta.character ?? guessChar;

  models.push({
    id: meta.id ?? dirName,
    dir: `/models/${encodeURIComponent(dirName)}/`,
    file: `/models/${encodeURIComponent(dirName)}/${encodeURIComponent(picked.file)}`,
    fileName: picked.file,
    kind: picked.kind,
    size: picked.size,
    game: meta.game ?? game,
    character,
    outfit: meta.outfit ?? '默认',
    name: meta.name ?? `${character}${meta.outfit && meta.outfit !== '默认' ? `（${meta.outfit}）` : ''}`,
    author: meta.author ?? '',
    source: meta.source ?? '',
    license: meta.license ?? '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    scale: meta.scale ?? 1,
    groundOffset: meta.groundOffset ?? null,
  });
}

models.sort((a, b) => a.game.localeCompare(b.game, 'zh') || a.character.localeCompare(b.character, 'zh'));

const games = [...new Set(models.map((m) => m.game))];
const index = {
  format: 'vrm-model-library/1',
  generatedAt: new Date().toISOString(),
  games,
  count: models.length,
  models,
};

const out = path.join(ROOT, 'index.json');
fs.writeFileSync(out, JSON.stringify(index, null, 2) + '\n');

export { models, index };

const isCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/scan-models.mjs');
if (isCli) {
  console.log(`扫描完成：${models.length} 个模型 / ${games.length} 个游戏`);
  for (const m of models) {
    console.log(`  [${m.game}] ${m.name}  ${m.kind}  ${(m.size / 1048576).toFixed(1)} MB  ${m.file}`);
  }
  console.log('写入:', out);
}
