import puppeteer from 'puppeteer-core';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9234';
const BASE = process.env.BASE || 'http://127.0.0.1:5280/';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[pmx]') || t.startsWith('[tune]')) console.log('  ', t);
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  await sleep(1500);

  // 模拟"用户选择整个文件夹"：把 public 里的模型文件抓下来，包成带相对路径的 File
  const built = await page.evaluate(async () => {
    const files = [];
    const pmxPath = '/models/weilina/维琳娜6.pmx';
    const texNames = ['脸.png', '体1.png', '体2.png', '皮肤1.png', '皮肤2.png', '发.png', '发+.png', '武器.png'];
    const wrap = async (url, rel) => {
      const r = await fetch(url);
      const buf = await r.arrayBuffer();
      const name = rel.split('/').pop();
      const f = new File([buf], name);
      f.__relPath = rel;
      return f;
    };
    files.push(await wrap(pmxPath, '维琳娜/维琳娜6.pmx'));
    for (const n of texNames) {
      files.push(await wrap(`/models/weilina/Texture/${encodeURIComponent(n)}`, `维琳娜/Texture/${n}`));
    }
    // WebP 版本也放进去，验证自动探测
    for (const n of texNames) {
      files.push(await wrap(`/models/weilina/Texture_webp/${encodeURIComponent(n.replace(/\.png$/, '.webp'))}`, `维琳娜/Texture_webp/${n.replace(/\.png$/, '.webp')}`));
    }
    window.__lastFiles = files;
    return files.length;
  });
  console.log('constructed files:', built);

  const result = await page.evaluate(async () => {
    const files = window.__lastFiles;
    await window.__loadFromFiles(files);
    return {
      status: document.getElementById('status')?.textContent,
      textures: window.__pmxTextures,
    };
  }).catch(async (e) => ({ error: e.message }));

  console.log('load result:', JSON.stringify(result));
  await sleep(2500);
  const after = await page.evaluate(() => ({
    kind: window.__poser.avatar?.kind,
    status: document.getElementById('status')?.textContent,
    textures: window.__pmxTextures,
  }));
  console.log('AFTER', JSON.stringify(after));
  await page.screenshot({ path: 'shots/folder-load.png' });
} catch (err) {
  console.log('FAIL', err.message);
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}

