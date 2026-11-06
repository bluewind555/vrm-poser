import puppeteer from 'puppeteer-core';

const URL = process.env.POSER_URL;
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9230';
const NAME = process.env.SHOT_NAME || 'worker';
const REPS = Number(process.env.REPS || 3);

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const runs = [];

for (let i = 0; i < REPS; i++) {
  const page = await browser.newPage();
  const t0 = Date.now();
  try {
    await page.evaluateOnNewDocument(() => {
      window.__longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__longTasks.push({ s: e.startTime, d: e.duration });
        }).observe({ entryTypes: ['longtask'] });
      } catch {}
    });
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
    const tReady = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 500));

    const out = await page.evaluate(() => {
      const p = window.__pmxParse;
      const lt = window.__longTasks || [];
      const [w0, w1] = p?.window ?? [0, 0];
      // 只统计"解析窗口内"的主线程长任务
      const inWindow = lt.filter((t) => t.s + t.d > w0 && t.s < w1);
      return {
        mode: p?.mode ?? null,
        parseMs: p?.ms ?? null,
        workerMs: p?.workerMs ?? null,
        blockedInWindowMs: Math.round(inWindow.reduce((a, b) => a + b.d, 0)),
        blockedInWindowCount: inWindow.length,
        totalLongTasks: lt.length,
        longestTaskMs: lt.length ? Math.round(Math.max(...lt.map((t) => t.d))) : 0,
      };
    });
    runs.push({ tReady, ...out });
    console.log(`run ${i + 1}:`, JSON.stringify({ tReady, ...out }));
  } catch (err) {
    console.log(`run ${i + 1} FAIL: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

const ok = runs.filter((r) => r.mode);
if (ok.length) {
  const med = (key) => {
    const vals = ok.map((r) => r[key]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : null;
  };
  console.log(
    'MEDIAN',
    JSON.stringify({
      mode: ok[0].mode,
      runs: ok.length,
      parseMs: med('parseMs'),
      blockedInWindowMs: med('blockedInWindowMs'),
      readyMs: med('tReady'),
    }),
  );
}

await browser.disconnect();
