import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9239", defaultViewport: null });
const p = await b.newPage();
await p.goto("http://localhost:5273/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 180000, polling: 300 });
await new Promise((r) => setTimeout(r, 2000));
const out = await p.evaluate(() => {
  const a = window.__poser.avatar;
  const T = window.__THREE;
  const probe = () => {
    a.root.position.y = 0;
    a.root.updateMatrixWorld(true);
    const y0 = a.getLowestWorldY();
    a.root.position.y = 0.5;
    a.root.updateMatrixWorld(true);
    const y1 = a.getLowestWorldY();
    a.root.position.y = 0;
    a.root.updateMatrixWorld(true);
    const foot = a.getBoneWorldPosition ? a.getBoneWorldPosition("leftFoot", new T.Vector3()) : null;
    const chain = [];
    let n = a.skeleton.bones[0];
    while (n) { chain.push(n.name || n.type); n = n.parent; }
    return { y0: +y0.toFixed(4), y1: +y1.toFixed(4), delta: +(y1 - y0).toFixed(4), footY: foot ? +foot.y.toFixed(3) : null, chain: chain.slice(0, 6) };
  };
  return probe();
});
console.log(JSON.stringify(out, null, 2));
await p.close();
await b.disconnect();
