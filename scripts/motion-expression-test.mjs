import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const SHOTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const smileWeight = () =>
  page.evaluate(() => {
    const a = window.__poser.avatar;
    const idx = a.morphList.find((m) => m.name === 'にっこり')?.targets[0]?.target;
    return idx === undefined ? null : a.mesh.morphTargetInfluences[idx];
  });

try {
  await page.setViewport({ width: 900, height: 900 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1500);
  await page.evaluate(() => {
    document.getElementById('panel').style.display = 'none';
    window.__poser.setViewPreset('closeup');
    const p = window.__poser;
    p.camera.position.lerp(p.controls.target, 0.45);
    p.camera.updateProjectionMatrix();
    p.controls.update();
  });
  await sleep(600);

  console.log('初始 微笑权重:', await smileWeight());

  // 挥手 → 应自动套微笑
  await page.evaluate(() => document.getElementById('btn-motion-wave').click());
  await sleep(900);
  console.log('挥手后 微笑权重:', await smileWeight());
  console.log('状态:', await page.evaluate(() => document.getElementById('status')?.textContent));
  await page.screenshot({ path: path.join(SHOTS, 'link-1-wave-smile.png') });

  // 停止 → 表情应清除
  await page.evaluate(() => document.getElementById('btn-motion-stop').click());
  await sleep(500);
  console.log('停止后 微笑权重:', await smileWeight());

  // 用户手动设了表情，再开动作：用户优先
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.expr-row')].find((r) => r.dataset.name === '怒り');
    const input = row.querySelector('input');
    input.value = '1';
    input.dispatchEvent(new Event('input'));
  });
  await sleep(300);
  await page.evaluate(() => document.getElementById('btn-motion-wave').click());
  await sleep(700);
  const both = await page.evaluate(() => {
    const a = window.__poser.avatar;
    const g = (n) => a.morphList.find((m) => m.name === n)?.targets[0]?.target;
    const i = a.mesh.morphTargetInfluences;
    return { 怒り: i[g('怒り')] ?? 0, にっこり: i[g('にっこり')] ?? 0 };
  });
  console.log('用户怒り + 挥手:', JSON.stringify(both));

  // 呼吸动作不配表情
  await page.evaluate(() => {
    document.getElementById('btn-motion-stop').click();
    document.getElementById('btn-expr-reset').click();
    document.getElementById('btn-motion-breath').click();
  });
  await sleep(600);
  console.log('呼吸时 微笑权重:', await smileWeight());
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
