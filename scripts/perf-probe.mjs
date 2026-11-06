import puppeteer from 'puppeteer-core';

const URL = process.env.POSER_URL;
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9230';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = await browser.newPage();
const t0 = Date.now();
try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction('window.__poserReady === true', { timeout: 120000, polling: 200 });
  const readyAt = Date.now() - t0;

  await page.waitForFunction('!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total', { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const stats = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'n/a';

    // 量 2 秒内的帧数
    const fps = await new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const loop = () => {
        frames += 1;
        if (performance.now() - start < 2000) requestAnimationFrame(loop);
        else resolve(Number((frames / ((performance.now() - start) / 1000)).toFixed(1)));
      };
      requestAnimationFrame(loop);
    });

    const mesh = window.__poser?.avatar?.mesh;
    return {
      renderer,
      fps,
      vertices: mesh?.geometry?.attributes?.position?.count ?? null,
      triangles: mesh?.geometry?.index ? mesh.geometry.index.count / 3 : null,
      textures: window.__pmxTextures ?? null,
      drawCalls: window.__poser?.renderer?.info?.render?.calls ?? null,
    };
  });

  console.log(JSON.stringify({ readyMs: readyAt, ...stats }, null, 2));
  await page.screenshot({ path: 'shots/gpu-940m.png' });
} finally {
  await page.close().catch(() => {});
  await browser.disconnect();
}
