import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9239", defaultViewport: null });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.setViewport({ width: 1440, height: 1000 });
await p.goto("http://127.0.0.1:5280/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 180000, polling: 300 });
await p.waitForFunction("!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total", { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await p.evaluate(() => document.getElementById("btn-gallery").click());
await p.waitForFunction(() => document.querySelectorAll(".pose-thumb.ready").length >= 13, { timeout: 180000, polling: 600 }).catch(() => {});
// 隐藏一个试试
await p.evaluate(() => {
  const card = [...document.querySelectorAll(".pose-card")][7];
  card?.querySelector(".pose-hide")?.click();
});
await new Promise((r) => setTimeout(r, 400));
const info = await p.evaluate(() => ({
  count: document.getElementById("gallery-count")?.textContent,
  hiddenBtn: document.getElementById("gallery-hidden")?.textContent,
  cards: document.querySelectorAll(".pose-card").length,
}));
console.log(JSON.stringify(info, null, 2));
await p.screenshot({ path: "shots/gallery-hide.png" });
await p.close();
await b.disconnect();
