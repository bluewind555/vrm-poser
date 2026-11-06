import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const SRC = '.tmp-posedata/batch-landmarks.json';
const OUT_DIR = 'public/poses/generated';
const MANIFEST = 'public/poses/manifest.json';

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const entries = Object.entries(data).filter(([, v]) => v.fused);
console.log('待转换:', entries.map(([k]) => k).join(' '));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.goto(`http://localhost:5273/?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', {
    timeout: 60000,
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const poses = await page.evaluate((list) => {
    const out = {};
    for (const [id, v] of list) {
      const pose = window.__poser.landmarksToPose(v.fused);
      if (pose) {
        pose.name = v.name;
        pose.meta = { ...(pose.meta || {}), source: 'ai-pose-gallery-zh', sourceId: id, views: v.viewCount };
        out[id] = pose;
      }
    }
    return out;
  }, entries);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const byId = new Map(manifest.poses.map((p) => [p.id, p]));

  const report = [];
  for (const [id, pose] of Object.entries(poses)) {
    const name = data[id]?.name ?? id;
    const category = data[id]?.category ?? '其它';
    const file = `/poses/generated/${id}.json`;
    fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(pose, null, 2));
    byId.set(`gen-${id}`, {
      id: `gen-${id}`,
      name,
      category,
      tags: ['图片生成', `${data[id]?.viewCount ?? 1}视图`],
      file,
      generated: true,
      flags: pose.meta?.lying ? ['lying'] : [],
    });
    const conf = Object.values(pose.meta?.confidence ?? {});
    const low = conf.filter((v) => v < 0.8).length;
    report.push({ id, name, category, bones: Object.keys(pose.bones).length, low, views: data[id]?.viewCount, lying: !!pose.meta?.lying });
  }

  manifest.poses = [...byId.values()];
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  console.log('\n生成结果：');
  for (const r of report.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  ${r.id} ${r.name.padEnd(12)} ${r.category.padEnd(8)} 骨骼 ${String(r.bones).padStart(2)}  低置信 ${r.low}  视图 ${r.views}${r.lying ? "  [躺卧·需手修]" : ""}`);
  }
  console.log(`\nmanifest 现有 ${manifest.poses.length} 条`);
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

