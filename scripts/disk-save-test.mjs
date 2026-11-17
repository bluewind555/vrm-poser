import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = 'http://localhost:5273/';
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_DIR = path.join(PROJECT, 'public', 'models', 'weilina');
const TARGET = path.join(PROJECT, 'public', 'models', '测试角色');

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 先清掉上次测试残留
  if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });

  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(1200);

  const built = await page.evaluate(async () => {
    const wrap = async (url, rel) => {
      const r = await fetch(url);
      const buf = await r.arrayBuffer();
      const f = new File([buf], rel.split('/').pop());
      f.__relPath = rel;
      return f;
    };
    const files = [await wrap('/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx', '测试角色/测试角色.pmx')];
    for (const [n, rel] of [
      ['脸.png', 'TestFace.png'],
      ['体1.png', 'TestBody.png'],
    ]) {
      try {
        files.push(await wrap(`/models/weilina/Texture/${encodeURIComponent(n)}`, `测试角色/Texture/${rel}`));
      } catch {
        /* 忽略 */
      }
    }
    window.__f = files;
    return files.length;
  });
  console.log('构造文件:', built);

  await page.evaluate(() => window.__loadFromFiles(window.__f));
  await page.waitForFunction(
    () => {
      const s = document.getElementById('status')?.textContent ?? '';
      return s.includes('已保存到') || s.includes('收藏到浏览器') || s.includes('失败');
    },
    { timeout: 180000, polling: 500 },
  );
  await sleep(1000);
  console.log('状态:', await page.evaluate(() => document.getElementById('status')?.textContent));

  // 磁盘验证
  const exists = fs.existsSync(TARGET);
  console.log('目录存在:', exists);
  if (exists) {
    const walk = (dir, prefix = '') =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name} (${fs.statSync(path.join(dir, e.name)).size})`],
      );
    console.log('文件:', walk(TARGET).join(', '));
  }

  // index.json 是否包含新模型
  const idx = JSON.parse(fs.readFileSync(path.join(PROJECT, 'public', 'models', 'index.json'), 'utf8'));
  console.log('索引里的模型:', idx.models.map((m) => m.name).join(', '));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
