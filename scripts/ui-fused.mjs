import puppeteer from "puppeteer-core";
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9239", defaultViewport: null });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.setViewport({ width: 1200, height: 900 });
await p.goto("http://localhost:5273/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 180000, polling: 300 });
await p.waitForFunction("!window.__pmxTextures || window.__pmxTextures.loaded >= window.__pmxTextures.total", { timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1200));
const input = await p.$("#pose-image");
await input.uploadFile(
  "public/models/posedata/P001_front.png",
  "public/models/posedata/P001_side.png",
  "public/models/posedata/P001_high.png",
);
await p.waitForFunction(() => {
  const s = document.getElementById("status")?.textContent || "";
  return s.includes("生成姿势") || s.includes("没找到人") || s.includes("失败");
}, { timeout: 180000, polling: 300 });
await new Promise((r) => setTimeout(r, 1200));
const info = await p.evaluate(() => ({
  status: document.getElementById("status")?.textContent,
  chips: [...document.querySelectorAll("#confidence .chip")].map((c) => c.textContent),
}));
console.log(JSON.stringify(info, null, 2));
await p.screenshot({ path: "shots/ui-fused.png" });
await p.close();
await b.disconnect();
