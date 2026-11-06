import fs from "node:fs";
import puppeteer from "puppeteer-core";
const data = JSON.parse(fs.readFileSync(".tmp-posedata/batch-landmarks.json", "utf8"));
const first = Object.entries(data).find(([, v]) => v.fused);
const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9239", defaultViewport: null });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto("http://localhost:5273/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
await p.waitForFunction("window.__poserReady === true", { timeout: 180000, polling: 300 });
await new Promise((r) => setTimeout(r, 1500));
const out = await p.evaluate((entry) => {
  const a = window.__poser.avatar;
  const h = a.humanoid;
  const names = ["hips", "chest", "upperChest", "neck", "head", "leftUpperArm", "rightUpperArm"];
  const info = {};
  for (const n of names) {
    const node = h?.getNormalizedBoneNode?.(n);
    info[n] = node ? `${node.type}:${typeof node.getWorldPosition}` : "null";
  }
  let err = null, stack = null;
  try { window.__poser.landmarksToPose(entry.fused); } catch (e) { err = e.message; stack = (e.stack || "").split("\n").slice(0, 5).join("\n"); }
  return { info, err, stack };
}, first[1]);
console.log(JSON.stringify(out, null, 2));
await p.close();
await b.disconnect();
