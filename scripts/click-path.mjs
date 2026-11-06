import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9231';
const BASE = process.env.BASE || 'http://localhost:5273/';
const MODEL = process.env.MODEL || 'model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const metrics = () =>
  page.evaluate(() => {
    const a = window.__poser.avatar;
    const T = window.__THREE;
    const pos = (n) => {
      const b = a.getBoneWorldPosition ? a.getBoneWorldPosition(n, new T.Vector3()) : a.humanoid?.getNormalizedBoneNode?.(n)?.getWorldPosition(new T.Vector3());
      return b ? [b.x, b.y, b.z].map((v) => +v.toFixed(3)) : null;
    };
    return {
      rootY: +a.root.position.y.toFixed(3),
      footL: pos('leftFoot'),
      footR: pos('rightFoot'),
      toesL: pos('leftToes'),
      hips: pos('hips'),
      head: pos('head'),
      groundClearance: a.groundClearance ?? null,
      meshMinY: (() => {
        const g = a.mesh?.geometry?.attributes?.position;
        if (!g) return null;
        let mn = Infinity;
        for (let i = 0; i < g.count; i += 3) { const y = g.getY(i); if (y < mn) mn = y; }
        return +mn.toFixed(4);
      })(),
      maxVertexY: (() => {
        const g = a.mesh?.geometry?.attributes?.position;
        if (!g) return null;
        let mx = -Infinity;
        for (let i = 0; i < g.count; i += 3) { const y = g.getY(i); if (y > mx) mx = y; }
        return +mx.toFixed(4);
      })(),
      status: document.getElementById('status')?.textContent,
      outline: a.mesh?.material?.[0]?.userData?.outlineParameters ?? null,
    };
  });

try {
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
    } catch {}
  });
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[tune]') || t.includes('[pmx]')) console.log('  console:', t, m.args && m.args().length ? JSON.stringify(m.args().map((a) => { try { return a.jsonValue(); } catch { return ''; } })) : '');
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(`${BASE}?${MODEL}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 30000 }).catch(() => {});
  await sleep(1200);

  console.log('A 初始(无姿势):', JSON.stringify(await metrics()));
  await page.screenshot({ path: 'shots/click-a-initial.png' });

  // 模拟用户点「坐姿」按钮
  const clicked = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#presets .chip')];
    const sit = chips.find((c) => c.textContent.includes('坐姿'));
    if (!sit) return { ok: false, labels: chips.map((c) => c.textContent) };
    sit.click();
    return { ok: true };
  });
  console.log('点击结果:', JSON.stringify(clicked));
  await sleep(1500);
  console.log('B 点击坐姿后:', JSON.stringify(await metrics()));
  await page.screenshot({ path: 'shots/click-b-sit.png' });

  // 再点「自然站立」
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll('#presets .chip')];
    chips.find((c) => c.textContent.includes('自然站立'))?.click();
  });
  await sleep(1200);
  console.log('C 点击自然站立后:', JSON.stringify(await metrics()));
  await page.screenshot({ path: 'shots/click-c-neutral.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}



