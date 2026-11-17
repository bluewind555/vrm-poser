import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = 'http://localhost:5273/';
const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(PROJECT, 'public', 'models', '测试角色A');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('dialog', async (d) => {
  console.log('  对话框:', d.message().split('\n')[0]);
  await d.accept();
});

try {
  if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true, force: true });

  await page.setViewport({ width: 1280, height: 950 });
  await page.goto(`${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(1000);

  await page.evaluate(async () => {
    const wrap = async (url, rel) => {
      const r = await fetch(url);
      const f = new File([await r.arrayBuffer()], rel.split('/').pop());
      f.__relPath = rel;
      return f;
    };
    window.__f = [
      await wrap('/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx', '测试角色A/测试A.pmx'),
    ];
  });

  await page.evaluate(() => window.__loadFromFiles(window.__f));
  await page.waitForFunction(
    () => (document.getElementById('status')?.textContent ?? '').includes('已保存到'),
    { timeout: 180000, polling: 400 },
  );
  console.log('① 保存:', await page.evaluate(() => document.getElementById('status')?.textContent));
  console.log('   目录存在:', fs.existsSync(TARGET), '| 文件:', fs.readdirSync(TARGET).join(', '));

  // 元数据表单应该自动弹出
  await page.waitForFunction(() => document.getElementById('modelmeta')?.classList.contains('open'), { timeout: 15000 });
  const prefill = await page.evaluate(() => ({
    title: document.getElementById('modelmeta-title')?.textContent,
    character: document.querySelector('[name="character"]')?.value,
    game: document.querySelector('[name="game"]')?.value,
  }));
  console.log('② 表单预填:', JSON.stringify(prefill));

  // 填写并保存
  await page.evaluate(() => {
    const set = (n, v) => {
      const el = document.querySelector(`#modelmeta-form [name="${n}"]`);
      el.value = v;
    };
    set('character', '测试角色A');
    set('game', '鸣潮');
    set('outfit', '测试装');
    set('tags', '测试 标签');
    document.querySelector('#modelmeta-form button[type="submit"]').click();
  });
  await sleep(2500);
  console.log('③ 保存后状态:', await page.evaluate(() => document.getElementById('status')?.textContent));

  const metaPath = path.join(TARGET, 'model.json');
  console.log('   model.json 存在:', fs.existsSync(metaPath));
  if (fs.existsSync(metaPath)) console.log('   内容:', fs.readFileSync(metaPath, 'utf8').replace(/\s+/g, ' ').trim());

  const idx = JSON.parse(fs.readFileSync(path.join(PROJECT, 'public', 'models', 'index.json'), 'utf8'));
  const hit = idx.models.find((m) => m.id === '测试角色A');
  console.log('④ 索引条目:', hit ? JSON.stringify({ game: hit.game, name: hit.name, outfit: hit.outfit }) : '未找到');

  // 删除：打开角色库点 ✕
  await page.evaluate(() => window.__modelLibrary.open());
  await sleep(1200);
  const removed = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll('.model-card')];
    const target = cards.find((c) => c.querySelector('strong')?.textContent?.includes('测试角色A'));
    if (!target) return 'card not found';
    target.querySelector('.model-act.del')?.click();
    return 'clicked';
  });
  console.log('⑤ 删除按钮:', removed);
  await sleep(2500);
  console.log('   目录已删:', !fs.existsSync(TARGET));
  console.log('   状态:', await page.evaluate(() => document.getElementById('status')?.textContent));
  const idx2 = JSON.parse(fs.readFileSync(path.join(PROJECT, 'public', 'models', 'index.json'), 'utf8'));
  console.log('   索引里还有测试角色A:', idx2.models.some((m) => m.id === '测试角色A'));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
