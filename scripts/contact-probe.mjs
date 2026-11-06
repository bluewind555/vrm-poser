import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9237", defaultViewport: null });
const p = await b.newPage();
await p.setViewport({ width: 1000, height: 700 });
await p.goto("http://127.0.0.1:5280/?cb=" + Date.now() + "&model=/models/xun/%E6%B5%94.pmx", { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 120000, polling: 200 });
await new Promise((r) => setTimeout(r, 2500));
const info = await p.evaluate(() => {
  const c = window.__poser.contactShadow;
  return {
    visible: c?.visible,
    pos: c ? c.position.toArray().map((v) => +v.toFixed(3)) : null,
    scale: c ? c.scale.toArray().map((v) => +v.toFixed(3)) : null,
    opacity: c?.material?.opacity,
    contactState: window.__tuning?.state?.contact,
  };
});
console.log("contactShadow:", JSON.stringify(info));
await p.screenshot({ path: "shots/contact-check.png" });
await p.close();
await b.disconnect();
