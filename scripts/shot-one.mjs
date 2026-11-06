import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.POSER_URL;
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9228';
const NAME = process.env.SHOT_NAME || 'pmx';
const OUT = path.resolve('shots');

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const errors = [];
const t0 = Date.now();

page.on('console', (m) => {
  const parts = m.args ? [] : [m.text()];
  const line = `[${m.type()}] ${m.text()}`;
  if (line.includes('[pmx]')) {
    Promise.all(m.args().map((a) => a.evaluate((v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v)))))
      .then((vals) => console.log('  ', `[${m.type()}]`, vals.join(' ')))
      .catch(() => {});
  }
  if (['error', 'warning', 'warn'].includes(m.type())) errors.push(line);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`));
page.on('requestfailed', (r) => errors.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`);
});

try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 250 });

  // PMX 的贴图是异步加载的，等全部到位再截图，否则会截到"黑模型"
  try {
    await page.waitForFunction(
      '!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total',
      { timeout: 30000, polling: 200 },
    );
    const t = await page.evaluate(() => window.__pmxTextures ?? null);
    if (t) console.log('  textures:', JSON.stringify(t));
  } catch {
    console.log('  textures: timeout waiting');
  }
  await new Promise((r) => setTimeout(r, 1200));

  if (process.env.CAM) {
    const [x, y, z, tx, ty, tz] = process.env.CAM.split(',').map(Number);
    await page.evaluate(
      ([x, y, z, tx, ty, tz]) => {
        const p = window.__poser;
        p.controls.target.set(tx, ty, tz);
        p.camera.position.set(x, y, z);
        p.controls.update();
      },
      [x, y, z, tx, ty, tz],
    );
    await new Promise((r) => setTimeout(r, 700));
  }

  if (process.env.ZOOM === '1') {
    await page.evaluate(() => {
      const p = window.__poser;
      p.controls.target.set(0, 1.0, 0);
      p.camera.position.set(0, 1.15, 2.1);
      p.controls.update();
    });
    await new Promise((r) => setTimeout(r, 800));
  }

  if (process.env.ZOOM === '2') {
    await page.evaluate(() => {
      const p = window.__poser;
      p.controls.target.set(0, 1.35, 0);
      p.camera.position.set(0.25, 1.4, 0.85);
      p.controls.update();
    });
    await new Promise((r) => setTimeout(r, 800));
  }

  const info = await page.evaluate(() => ({
    kind: window.__poser?.avatar?.kind,
    status: document.getElementById('status')?.textContent,
    debug: window.__pmxDebug ? window.__pmxDebug() : null,
  }));
  if (info.debug) console.log('DEBUG', JSON.stringify(info.debug));
  console.log('OK', ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, `${NAME}.png`) });
  console.log('shot:', path.join(OUT, `${NAME}.png`));
} catch (err) {
  console.log('FAIL', ((Date.now() - t0) / 1000).toFixed(1) + 's', err.message);
  try {
    console.log(
      'state:',
      JSON.stringify(
        await page.evaluate(() => ({
          ready: window.__poserReady ?? null,
          kind: window.__poser?.avatar?.kind ?? null,
          status: document.getElementById('status')?.textContent,
        })),
      ),
    );
  } catch {}
  await page.screenshot({ path: path.join(OUT, `fail-${NAME}.png`) }).catch(() => {});
  console.log('errors:\n' + errors.slice(0, 8).join('\n'));
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
