import puppeteer from 'puppeteer-core';

const b = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://127.0.0.1:9240', defaultViewport: null });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));

const snap = () =>
  p.evaluate(() => {
    const names = ['センター', '下半身', '上半身', '上半身2', '左足', '右足', '左ひざ', '右ひざ', '左腕', '右腕'];
    const out = {};
    for (const n of names) {
      const bo = window.__poser.avatar?.bones?.get(n);
      out[n] = bo ? { q: bo.quaternion.toArray().map((v) => +v.toFixed(3)), pos: bo.position.toArray().map((v) => +v.toFixed(3)) } : null;
    }
    return out;
  });

await p.setViewport({ width: 1000, height: 900 });
await p.goto(
  'http://127.0.0.1:5280/?cb=' + Date.now() + '&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx&pose=/poses/neutral.json',
  { waitUntil: 'domcontentloaded', timeout: 90000 },
);
await p.waitForFunction('window.__poserReady === true', { timeout: 180000, polling: 300 });
await new Promise((r) => setTimeout(r, 2000));

const before = await snap();
await p.evaluate(() => document.getElementById('btn-motion-vmd2').click());
await new Promise((r) => setTimeout(r, 1500));
const after = await snap();

for (const k of Object.keys(before)) {
  const bq = JSON.stringify(before[k]);
  const aq = JSON.stringify(after[k]);
  console.log((bq === aq ? '   ' : '≠  ') + k.padEnd(6), bq === aq ? '(未变)' : 'before ' + bq + '\n         after  ' + aq);
}

await p.close();
await b.disconnect();
