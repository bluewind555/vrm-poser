import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9236';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 220)}`));
await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
await new Promise((r) => setTimeout(r, 3000));
const info = await page.evaluate(() => ({
  version: document.getElementById('app-version')?.textContent,
  scripts: [...document.querySelectorAll('script[src]')].map((s) => s.src),
  kind: window.__poser.avatar?.kind,
  sph: (window.__poser.avatar?.mesh?.material ?? []).filter((m) => m.userData?.sph).length,
  textures: window.__pmxTextures,
}));
console.log(JSON.stringify(info, null, 2));
console.log('LOGS:\n' + logs.filter((l) => /env 调试|\[pmx\]|error/i.test(l)).slice(0, 14).join('\n'));
await page.close();
await browser.disconnect();
