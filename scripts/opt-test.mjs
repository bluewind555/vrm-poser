import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9240';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const requested = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.endsWith('.js')) requested.push(u.split('/').pop());
});

try {
  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 300 });
  await sleep(800);

  console.log('首屏加载的 JS:', JSON.stringify(requested));
  console.log('imagepose 是否已加载:', requested.some((f) => f.startsWith('imagepose')));

  // 打开角色库点「浔」（较慢），观察进度条
  await page.evaluate(() => window.__modelLibrary.open());
  await sleep(1200);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.model-card')];
    const xun = cards.find((c) => c.querySelector('strong')?.textContent?.includes('浔'));
    xun?.click();
  });

  const samples = [];
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const s = await page.evaluate(() => {
      const el = document.getElementById('load-progress');
      const bar = document.getElementById('load-progress-bar');
      return {
        hidden: el?.hidden,
        text: document.getElementById('load-progress-text')?.textContent ?? '',
        width: bar?.style.width ?? '',
        status: document.getElementById('status')?.textContent ?? '',
      };
    });
    samples.push(s);
    if (s.status.includes('已加载') && s.hidden) break;
  }
  const visible = samples.filter((s) => !s.hidden);
  console.log('进度条出现过', visible.length, '次采样');
  for (const s of [...new Set(visible.map((v) => v.text))].slice(0, 6)) console.log('   文本:', s);
  console.log('最终状态:', samples[samples.length - 1].status);
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
