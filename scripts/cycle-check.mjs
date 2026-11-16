import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9240", defaultViewport: null });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 900 });
await p.goto("http://127.0.0.1:5280/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 120000, polling: 300 });
await new Promise((r) => setTimeout(r, 1000));
await p.evaluate(() => document.querySelector(".model-card")?.click());
await new Promise((r) => setTimeout(r, 6000));
const out = await p.evaluate(() => {
  const scene = window.__poser.scene ?? window.__THREE_SCENE;
  const root = (window.__poser.avatar?.root);
  const res = { hasScene: !!scene, cycles: [], nodeCount: 0, rootChildren: root?.children?.length ?? null };
  if (scene) {
    const seen = new Set();
    let count = 0;
    const walk = (o, depth) => {
      if (depth > 200) { res.cycles.push({ name: o.name || o.type, reason: "too deep" }); return; }
      if (seen.has(o)) { res.cycles.push({ name: o.name || o.type, depth }); return; }
      seen.add(o);
      count++;
      for (const c of o.children ?? []) walk(c, depth + 1);
    };
    walk(scene, 0);
    res.nodeCount = count;
  }
  return res;
});
console.log(JSON.stringify(out, null, 2));
await p.close(); await b.disconnect();
