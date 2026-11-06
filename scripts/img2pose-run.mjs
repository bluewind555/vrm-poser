import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9239';
const BASE = process.env.BASE || 'http://localhost:5273/';
const MODEL = process.env.MODEL || '';
const VIEW = process.env.VIEW || 'front';
const LANDMARKS = process.env.LANDMARKS || '.tmp-posedata/landmarks.json';

const data = JSON.parse(fs.readFileSync(LANDMARKS, 'utf8'));
const entry = data[VIEW];
if (!entry?.found) {
  console.log('该视图没有关键点:', VIEW);
  process.exit(1);
}

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[pmx]')) console.log('  ', t.slice(0, 160));
});

const url = `${BASE}?cb=${Date.now()}${MODEL ? `&model=${MODEL}` : ''}`;

try {
  await page.setViewport({ width: 1200, height: 900 });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', {
    timeout: 60000,
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const pose = await page.evaluate((world) => window.__poser.applyLandmarks(world), entry.world);
  console.log('生成的姿势骨骼数:', Object.keys(pose?.bones ?? {}).length);
  fs.writeFileSync(`.tmp-posedata/pose-${VIEW}.json`, JSON.stringify(pose, null, 2));

  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `shots/img2pose-${VIEW}-front.png` });

  // 转到 3/4 视角看清四肢关系
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.7, 0.1);
    p.camera.position.set(2.2, 1.0, 2.2);
    p.controls.update();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `shots/img2pose-${VIEW}-34.png` });

  // 侧视角
  await page.evaluate(() => {
    const p = window.__poser;
    p.controls.target.set(0, 0.7, 0.1);
    p.camera.position.set(3.2, 0.9, 0.05);
    p.controls.update();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `shots/img2pose-${VIEW}-side.png` });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
