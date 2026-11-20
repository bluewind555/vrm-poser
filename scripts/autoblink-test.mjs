import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.setViewport({ width: 900, height: 800 });
  await page.goto(
    `${BASE}?cb=${Date.now()}&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
  await sleep(1500);

  const btn = await page.evaluate(() => {
    const b = document.getElementById('btn-autoblink');
    return { text: b?.textContent, disabled: b?.disabled, title: b?.title };
  });
  console.log('按钮:', JSON.stringify(btn));

  // 监控 8 秒内眨眼次数（用 requestAnimationFrame 采样 morph 权重）
  const result = await page.evaluate(async () => {
    const a = window.__poser.avatar;
    const idx = a.morphList.find((m) => m.name === 'まばたき')?.targets[0]?.target;
    if (idx === undefined) return { error: 'no blink morph' };
    const influences = () => a.mesh.morphTargetInfluences[idx];
    let blinks = 0;
    let wasClosed = false;
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const closed = influences() > 0.5;
        if (closed && !wasClosed) blinks += 1;
        wasClosed = closed;
        if (performance.now() - t0 < 9000) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    return { blinks, seconds: 9, finalWeight: influences() };
  });
  console.log('9 秒内眨眼:', JSON.stringify(result));

  // 关掉后应不再眨
  await page.evaluate(() => document.getElementById('btn-autoblink').click());
  await sleep(200);
  const off = await page.evaluate(() => document.getElementById('btn-autoblink')?.textContent);
  const after = await page.evaluate(async () => {
    const a = window.__poser.avatar;
    const idx = a.morphList.find((m) => m.name === 'まばたき')?.targets[0]?.target;
    let blinks = 0;
    let wasClosed = false;
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const closed = a.mesh.morphTargetInfluences[idx] > 0.5;
        if (closed && !wasClosed) blinks += 1;
        wasClosed = closed;
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    return blinks;
  });
  console.log('关闭后按钮:', off, '| 6 秒内眨眼:', after);
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
