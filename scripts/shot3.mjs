import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.POSER_URL || 'http://localhost:5274/';
const OUT = path.resolve('shots');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9225';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shots = [
  ['', '20-rest'],
  ['?pose=/poses/neutral.json', '21-neutral'],
  ['?pose=/poses/wave.json', '22-wave'],
  ['?pose=/poses/sit.json', '23-sit'],
];

for (const [query, name] of shots) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warn') errors.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

    const t0 = Date.now();
    await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('window.__poserReady === true', { timeout: 240000, polling: 500 });
    await sleep(1500);

    const info = await page.evaluate(() => ({
      kind: window.__poser?.avatar?.kind,
      status: document.getElementById('status')?.textContent,
      json: document.getElementById('json')?.value?.length ?? 0,
    }));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`OK ${name} (${((Date.now() - t0) / 1000).toFixed(0)}s)`, JSON.stringify(info), errors.length ? `errors=${errors.length}: ${errors.slice(0, 3).join(' | ')}` : '');
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }
}

await browser.disconnect();
