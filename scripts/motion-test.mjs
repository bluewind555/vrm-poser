import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 造一个最小合法 VMD（骨名用 ASCII，验证解析/播放链路即可） */
function makeTestVmd() {
  const motions = 8;
  const parts = [];
  const magic = Buffer.alloc(30);
  magic.write('Vocaloid Motion Data 0002', 'latin1');
  parts.push(magic, Buffer.alloc(20), Buffer.alloc(4));
  parts[2].writeUInt32LE(motions, 0);
  for (let i = 0; i < motions; i++) {
    const name = Buffer.alloc(15);
    name.write('TEST_BONE', 'latin1');
    const frame = Buffer.alloc(4);
    frame.writeUInt32LE(i * 15, 0);
    const pos = Buffer.alloc(12);
    const rot = Buffer.alloc(16);
    const ang = Math.sin((i / motions) * Math.PI * 2) * 0.3;
    rot.writeFloatLE(0, 0);
    rot.writeFloatLE(Math.sin(ang / 2), 4);
    rot.writeFloatLE(0, 8);
    rot.writeFloatLE(Math.cos(ang / 2), 12);
    parts.push(name, frame, pos, rot, Buffer.alloc(64));
  }
  const tail = Buffer.alloc(8);
  parts.push(tail);
  return Buffer.concat(parts);
}

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const boneRot = (name) =>
  page.evaluate((n) => {
    const node = window.__poser.avatar?.humanoid?.getNormalizedBoneNode?.(n);
    if (!node) return null;
    return [+node.rotation.x.toFixed(4), +node.rotation.y.toFixed(4), +node.rotation.z.toFixed(4)];
  }, name);

try {
  await page.setViewport({ width: 1100, height: 950 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1500);

  // 呼吸：不同时刻胸腔应有不同角度
  await page.evaluate(() => document.getElementById('btn-motion-breath').click());
  await sleep(300);
  const a1 = await boneRot('chest');
  await sleep(700);
  const a2 = await boneRot('chest');
  console.log('呼吸 chest:', JSON.stringify(a1), '→', JSON.stringify(a2), a1[0] !== a2[0] ? '✓ 在动' : '✗ 没动');

  // 挥手：右臂应抬起
  await page.evaluate(() => document.getElementById('btn-motion-wave').click());
  await sleep(1200);
  const arm = await boneRot('rightUpperArm');
  console.log('挥手 rightUpperArm:', JSON.stringify(arm));
  await page.screenshot({ path: path.join(SHOTS, 'motion-wave.png') });

  // 停止后应回到姿势
  await page.evaluate(() => document.getElementById('btn-motion-stop').click());
  await sleep(600);
  const arm2 = await boneRot('rightUpperArm');
  console.log('停止后 rightUpperArm:', JSON.stringify(arm2));
  console.log('动作名:', await page.evaluate(() => document.getElementById('motion-name')?.textContent));

  // 载入合成 VMD
  const tmp = path.join(os.tmpdir(), 'test-motion.vmd');
  fs.writeFileSync(tmp, makeTestVmd());
  const input = await page.$('#vmd-file');
  await input.uploadFile(tmp);
  await sleep(1500);
  console.log('VMD:', await page.evaluate(() => document.getElementById('status')?.textContent));
  console.log('动作名:', await page.evaluate(() => document.getElementById('motion-name')?.textContent));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
