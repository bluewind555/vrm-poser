/**
 * CI 用：把 public/models/index.json 重置为空库。
 *
 * 仓库里这份索引记录了本地两个模型（维琳娜 / 浔），但它们的文件不入库，
 * 直接发布会让线上角色库出现两个点不开的坏卡片。
 */
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('public/models/index.json');
const empty = {
  format: 'vrm-model-library/1',
  generatedAt: new Date().toISOString(),
  games: [],
  count: 0,
  models: [],
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(empty, null, 2) + '\n');
console.log('已写入空索引:', out);
