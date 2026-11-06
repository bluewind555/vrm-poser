import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.POSER_URL || 'http://127.0.0.1:5280/';
const OUT = path.resolve('shots');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9228';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shots = [
  ['', '40-rest'],
  ['?pose=/poses/neutral.json', '41-neutral'],
  ['?pose=/poses/wave.json', '42-wave'],
  ['?pose=/poses/sit.json', '43-sit'],
];

const only = (process.env.SHOTS || '').split(',').map((s) => s.trim()).filter(Boolean);
const queue = only.length ? shots.filter(([, n]) => only.includes(n)) : shots;

for (const [query, name] of queue) {
  const page = await browser.newPage();
  const errors = [];
  const t0 = Date.now();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    page.on('console', (m) => {
      const line = `[${m.type()}] ${m.text()}`;
      if (['error', 'warning', 'warn'].includes(m.type())) errors.push(line);
      if (m.text().includes('[pose]')) console.log('  page:', line);
    });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

    await page.goto(BASE + query, { waitUntil: 'domcontentloaded', timeout: 90000 });

    const gpu = await page
      .evaluate(() => {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        if (!gl) return 'no webgl2';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      })
      .catch((e) => 'probe failed: ' + e.message);
    console.log(`[${name}] GPU: ${gpu}`);

    await page.waitForFunction('window.__poser !== undefined', { timeout: 30000, polling: 200 });
    console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] module executed`);

    await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 250 });
    await sleep(1200);

    const info = await page.evaluate(() => ({
      kind: window.__poser?.avatar?.kind,
      status: document.getElementById('status')?.textContent,
      bones: Object.keys(JSON.parse(document.getElementById('json')?.value || '{"bones":{}}').bones || {}).length,
    }));
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`OK ${name} ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(info));
  } catch (err) {
    const state = await page
      .evaluate(() => ({
        hasPoser: !!window.__poser,
        ready: window.__poserReady ?? null,
        kind: window.__poser?.avatar?.kind ?? null,
        status: document.getElementById('status')?.textContent,
      }))
      .catch(() => null);
    console.log(`FAIL ${name} after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
    console.log('  state:', JSON.stringify(state));
    console.log('  errors:', errors.slice(0, 6).join(' || ') || '(none)');
    await page.screenshot({ path: path.join(OUT, `fail-${name}.png`) }).catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
}

await browser.disconnect();
