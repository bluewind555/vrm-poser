const html = await (await fetch("http://127.0.0.1:5280/")).text();
const mm = html.match(/src="([^"]+\.js)"/);
const t = await (await fetch("http://127.0.0.1:5280" + mm[1])).text();
for (const v of ["v17", "v18"]) console.log(v, t.includes(v) ? "present" : "-");
console.log("fuseViews:", t.includes("多视图融合") ? "ok" : "MISSING");
