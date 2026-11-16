import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9240", defaultViewport: null });
async function run(url, label) {
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message + " | " + (e.stack||"").split("\n")[1]));
  await p.setViewport({ width: 1000, height: 800 });
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await p.waitForFunction("window.__poserReady === true", { timeout: 120000, polling: 300 });
  await new Promise((r) => setTimeout(r, 4000));
  const st = await p.evaluate(() => ({ kind: window.__poser.avatar?.kind, status: document.getElementById("status")?.textContent }));
  console.log(label, JSON.stringify(st), "errors:", errs.length ? errs.slice(0,2) : "none");
  await p.close();
}
const base = "http://127.0.0.1:5280/?cb=" + Date.now();
await run(base + "&model=/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx", "直链加载");
await b.disconnect();
