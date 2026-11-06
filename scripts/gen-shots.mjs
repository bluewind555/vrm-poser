import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9239", defaultViewport: null });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 900 });
await p.goto("http://localhost:5273/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 180000, polling: 300 });
await p.waitForFunction("!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total", { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
for (const id of ["P016", "P077", "P063"]) {
  await p.evaluate((pid) => window.__poser.applyPreset(`/poses/generated/${pid}.json`), id);
  await new Promise((r) => setTimeout(r, 900));
  await p.screenshot({ path: `shots/gen-${id}.png` });
}
await p.close();
await b.disconnect();
