import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9239", defaultViewport: null });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
p.on("console", (m) => { const t = m.text(); if (t.includes("[gallery]")) console.log("  ", t); });
await p.setViewport({ width: 1280, height: 900 });
await p.goto("http://localhost:5273/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 180000, polling: 300 });
await p.waitForFunction("!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total", { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
await p.evaluate(() => document.getElementById("btn-gallery").click());
await new Promise((r) => setTimeout(r, 600));
// 等缩略图烤完（3 张）
await p.waitForFunction(() => document.querySelectorAll(".pose-thumb.ready").length >= 3, { timeout: 60000, polling: 400 }).catch(() => {});
const info = await p.evaluate(() => ({
  open: document.getElementById("gallery")?.classList.contains("open"),
  count: document.getElementById("gallery-count")?.textContent,
  cards: [...document.querySelectorAll(".pose-card")].map((c) => c.querySelector("strong")?.textContent),
  ready: document.querySelectorAll(".pose-thumb.ready").length,
  firstThumbLen: document.querySelector(".pose-thumb.ready img")?.src.length ?? 0,
}));
console.log(JSON.stringify(info, null, 2));
await p.screenshot({ path: "shots/gallery.png" });
await p.close();
await b.disconnect();
