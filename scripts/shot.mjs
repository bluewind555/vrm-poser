import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.POSER_URL || 'http://localhost:5273/';
const OUT = path.resolve('shots');
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9224';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('HARD TIMEOUT 150s')), 150000));

async function run() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', (m) => console.log('BROWSER', `[${m.type()}]`, m.text()));
  page.on('pageerror', (e) => console.log('BROWSER [pageerror]', e.message));
  page.on('requestfailed', (r) => console.log('NET FAIL', r.url(), r.failure()?.errorText));
  page.on('response', (r) => {
    if (r.status() >= 400) console.log('NET', r.status(), r.url());
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('== dom loaded');

  try {
    await page.waitForFunction('window.__poser && window.__poser.avatar', { timeout: 90000, polling: 500 });
    console.log('== avatar appeared');
  } catch {
    console.log('== avatar did NOT appear within 90s');
  }

  const info = await page.evaluate(() => {
    const a = window.__poser?.avatar;
    return {
      hasPoser: !!window.__poser,
      kind: a?.kind ?? null,
      status: document.getElementById('status')?.textContent,
      debug: window.__poser?.debug ?? null,
    };
  });
  console.log('== INFO', JSON.stringify(info));

  await page.screenshot({ path: path.join(OUT, '10-loaded.png') });
  console.log('== shot 10-loaded.png');
  await page.close();
}

try {
  await Promise.race([run(), timeout]);
} catch (err) {
  console.log('FAILED', err.message);
} finally {
  await browser.disconnect();
}
