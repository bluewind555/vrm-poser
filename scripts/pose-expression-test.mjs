import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const smile = () =>
  page.evaluate(() => {
    const a = window.__poser.avatar;
    const idx = a.morphList.find((m) => m.name === 'にっこり')?.targets[0]?.target;
    return idx === undefined ? null : +a.mesh.morphTargetInfluences[idx].toFixed(2);
  });

try {
  await page.setViewport({ width: 1100, height: 1000 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.evaluate(() => localStorage.removeItem('vrm-poser:presets'));
  await sleep(1200);

  // 1) 设表情 + 存为预设
  const saved = await page.evaluate(() => {
    window.__poser.expressions.setWeights({ にっこり: 0.9 });
    const nameInput = prompt;
    // 直接调内部保存路径：点按钮会弹 prompt，这里临时覆盖
    window.prompt = () => '带表情的姿势';
    document.getElementById('btn-save').click();
    const raw = localStorage.getItem('vrm-poser:presets');
    const list = raw ? JSON.parse(raw) : [];
    return list.map((p) => ({ name: p.name, expression: p.meta?.expression ?? null }));
  });
  console.log('① 存为预设:', JSON.stringify(saved));

  // 2) 清表情，再应用该预设 → 表情应恢复
  const applied = await page.evaluate(async () => {
    window.__poser.expressions.reset();
    const before = (() => {
      const a = window.__poser.avatar;
      const idx = a.morphList.find((m) => m.name === 'にっこり')?.targets[0]?.target;
      return +a.mesh.morphTargetInfluences[idx].toFixed(2);
    })();
    const raw = localStorage.getItem('vrm-poser:presets');
    const list = JSON.parse(raw);
    window.__poser.applyPose(list[0]);
    await new Promise((r) => setTimeout(r, 300));
    const a = window.__poser.avatar;
    const idx = a.morphList.find((m) => m.name === 'にっこり')?.targets[0]?.target;
    return { before, after: +a.mesh.morphTargetInfluences[idx].toFixed(2) };
  });
  console.log('② 应用预设:', JSON.stringify(applied));

  // 3) 覆盖保存路径
  const overwrite = await page.evaluate(() => {
    window.__poser.expressions.setWeights({ まばたき: 1 });
    const btn = document.getElementById('btn-overwrite');
    const prev = window.confirm;
    window.confirm = () => true;
    btn?.click();
    window.confirm = prev;
    return 'clicked';
  });
  await sleep(600);
  console.log('③ 覆盖保存:', overwrite, '| 状态:', await page.evaluate(() => document.getElementById('status')?.textContent));
  console.log('   当前微笑权重:', await smile());
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

