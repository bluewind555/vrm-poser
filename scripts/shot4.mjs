import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.POSER_URL || 'http://localhost:5273/';
const OUT = path.resolve('shots');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9226';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shots = [
  ['?pose=/poses/neutral.json', '31-neutral'],
  ['?pose=/poses/wave.json', '32-wave'],
  ['?pose=/poses/sit.json', '33-sit'],
];

for (const [query, name] of shots) {
  const page = await browser.newPage();
  const errors = [];
  const t0 = Date.now();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    page.on('console', (m) => {
      const line = `[${m.type()}] ${m.text()}`;
      if (m.type() === 'error' || m.type() === 'warning' || m.type() === 'warn') errors.push(line);
      if (m.text().includes('[pose]')) console.log('  page:', line);
    });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

    const t0 = Date.now();
    await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 每 20 秒把页面状态打出来，失败时能看到卡在哪
    const watch = setInterval(async () => {
      try {
        const s = await page.evaluate(() => ({
          ready: window.__poserReady ?? null,
          kind: window.__poser?.avatar?.kind ?? null,
          status: document.getElementById('status')?.textContent,
        }));
        console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s]`, JSON.stringify(s));
      } catch {}
    }, 20000);

    await page.waitForFunction('window.__poserReady === true', { timeout: 200000, polling: 500 });
    clearInterval(watch);
    await sleep(1500);

    const info = await page.evaluate(() => ({
      kind: window.__poser?.avatar?.kind,
      status: document.getElementById('status')?.textContent,
      bones: Object.keys(JSON.parse(document.getElementById('json')?.value || '{"bones":{}}').bones || {}).length,
    }));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`OK ${name} ${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(info));
  } catch (err) {
    const state = await page
      .evaluate(() => ({
        hasPoser: !!window.__poser,
        ready: window.__poserReady ?? null,
        kind: window.__poser?.avatar?.kind ?? null,
        status: document.getElementById('status')?.textContent,
      }))
      .catch(() => null);
    console.log(`FAIL ${name} after ${((Date.now() - t0) / 1000).toFixed(0)}s: ${err.message}`);
    console.log('  state:', JSON.stringify(state));
    console.log('  errors:', errors.slice(0, 6).join(' || ') || '(none)');
    await page.screenshot({ path: path.join(OUT, `fail-${name}.png`) }).catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
}

await browser.disconnect();
