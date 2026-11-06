import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.POSER_URL || 'http://localhost:5273/';
const OUT = path.resolve('shots');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9224';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hardTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('HARD TIMEOUT 240s')), 240000));

async function run() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', (m) => console.log('BROWSER', `[${m.type()}]`, m.text()));
  page.on('pageerror', (e) => console.log('BROWSER [pageerror]', e.message));

  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(120000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('window.__poser && window.__poser.avatar', { timeout: 150000, polling: 500 });
  await sleep(1500);

  const bones = await page.evaluate(() => {
    const a = window.__poser.avatar;
    const names = [
      'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
      'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
      'rightUpperArm', 'rightLowerArm',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg',
    ];
    return {
      kind: a.kind,
      status: document.getElementById('status').textContent,
      present: names.filter((n) => !!a.humanoid.getNormalizedBoneNode(n)).length,
      total: names.length,
      // 归一化骨骼的 rest 四元数：理论上约等于单位四元数
      restSample: a.humanoid.getNormalizedBoneNode('leftUpperArm')?.quaternion.toArray().map((v) => +v.toFixed(4)),
    };
  });
  console.log('BONES', JSON.stringify(bones));

  const shots = [
    [0, '11-neutral'],
    [1, '12-wave'],
    [2, '13-sit'],
  ];
  for (const [idx, name] of shots) {
    const clicked = await page.evaluate((i) => {
      const chip = document.querySelectorAll('#presets .chip')[i];
      if (!chip) return false;
      chip.click();
      return true;
    }, idx);
    if (!clicked) continue;
    await sleep(1500);
    const st = await page.$eval('#status', (el) => el.textContent);
    console.log(`[${name}] ${st}`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  }

  // JSON 往返：导出 -> 清空姿势 -> 粘贴回来
  const exported = await page.evaluate(() => {
    document.getElementById('btn-copy').click();
    return document.getElementById('json').value;
  });
  console.log('EXPORT len', exported.length, 'first bones:', Object.keys(JSON.parse(exported).bones).join(','));

  await page.click('#btn-all-reset');
  await sleep(600);
  await page.evaluate((txt) => {
    document.getElementById('json').value = txt;
    document.getElementById('btn-apply').click();
  }, exported);
  await sleep(1000);
  console.log('ROUNDTRIP', await page.$eval('#status', (el) => el.textContent));
  await page.screenshot({ path: path.join(OUT, '14-roundtrip.png') });

  await page.close();
}

try {
  await Promise.race([run(), hardTimeout]);
} catch (err) {
  console.log('FAILED', err.message);
} finally {
  await browser.disconnect();
}
