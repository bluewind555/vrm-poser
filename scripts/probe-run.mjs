import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9239", defaultViewport: null });
const p = await b.newPage();
p.on("console", (m) => { const t = m.text(); if (t.includes("[probe]")) console.log("  ", t); });
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto("http://localhost:5273/pose-probe.html?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__done === true", { timeout: 300000, polling: 800 });
console.log(JSON.stringify(await p.evaluate(() => ({ data: window.__probe, err: window.__error })), null, 1).slice(0, 1500));
await p.close(); await b.disconnect();
