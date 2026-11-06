import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9230", defaultViewport: null });
const p = await b.newPage();
await p.goto("about:blank");
const info = await p.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  if (!gl) return { webgl2: false };
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  };
});
console.log(JSON.stringify(info, null, 2));
await p.close();
await b.disconnect();
