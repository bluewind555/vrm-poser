const html = await (await fetch("http://127.0.0.1:5280/")).text();
const mm = html.match(/src="([^"]+\.js)"/);
const t = await (await fetch("http://127.0.0.1:5280" + mm[1])).text();
console.log("v19:", t.includes("v19 · 2026-11-06") ? "ok" : "MISSING");
console.log("gallery:", t.includes("姿势库画廊") || t.includes("gallery-grid") ? "ok" : "MISSING");
console.log("has gallery DOM:", html.includes('id="gallery-grid"') ? "ok" : "MISSING");
console.log("manifest:", (await fetch("http://127.0.0.1:5280/poses/manifest.json")).status);
