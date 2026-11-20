import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.setViewport({ width: 1100, height: 1000 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await page.evaluate(() => localStorage.removeItem('vrm-poser:presets'));
  await sleep(1200);

  // 1) 挥手 + 微笑 → 存为预设
  const saved = await page.evaluate(async () => {
    window.prompt = () => '挥手快照';
    document.getElementById('btn-motion-wave').click();
    window.__poser.expressions.setWeights({ にっこり: 0.8 });
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('btn-save').click();
    const list = JSON.parse(localStorage.getItem('vrm-poser:presets') || '[]');
    return list.map((p) => ({ name: p.name, expression: p.meta?.expression, motion: p.meta?.motion }));
  });
  console.log('① 保存:', JSON.stringify(saved));

  // 2) 停止动作、清表情 → 应用预设
  const restored = await page.evaluate(async () => {
    document.getElementById('btn-motion-stop').click();
    window.__poser.expressions.reset();
    await new Promise((r) => setTimeout(r, 300));
    const before = {
      motion: document.getElementById('motion-name')?.textContent,
      locked: document.body.classList.contains('pose-locked'),
    };
    const list = JSON.parse(localStorage.getItem('vrm-poser:presets') || '[]');
    window.__poser.applyPose(list.find((p) => p.name === '挥手快照'));
    await new Promise((r) => setTimeout(r, 900));
    const a = window.__poser.avatar;
    const idx = a.morphList.find((m) => m.name === 'にっこり')?.targets[0]?.target;
    return {
      before,
      after: {
        motion: document.getElementById('motion-name')?.textContent,
        locked: document.body.classList.contains('pose-locked'),
        smile: +a.mesh.morphTargetInfluences[idx].toFixed(2),
      },
    };
  });
  console.log('② 应用:', JSON.stringify(restored));

  // 3) VMD 动作也能存
  const vmdCase = await page.evaluate(async () => {
    document.getElementById('btn-motion-stop').click();
    document.getElementById('btn-motion-vmd1').click();
    await new Promise((r) => setTimeout(r, 1200));
    window.prompt = () => 'VMD快照';
    document.getElementById('btn-save').click();
    const list = JSON.parse(localStorage.getItem('vrm-poser:presets') || '[]');
    const p = list.find((x) => x.name === 'VMD快照');
    return p?.meta?.motion ?? null;
  });
  console.log('③ VMD 保存:', JSON.stringify(vmdCase));
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
