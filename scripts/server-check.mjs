const check = async (u) => { try { const r = await fetch("http://127.0.0.1:5280" + u); return r.status; } catch (e) { return "ERR"; } };
console.log("index    :", await check("/"));
console.log("js       :", await check("/assets/index-BISe3-MQ.js"));
console.log("weilina  :", await check("/models/weilina/%E7%BB%B4%E7%90%B3%E5%A8%9C6.pmx"));
console.log("xun pmx  :", await check("/models/xun/%E6%B5%94.pmx"));
console.log("xun tex  :", await check("/models/xun/tex/T_player_029_jin_face_d.TGA"));
console.log("pose json:", await check("/poses/sit.json"));
console.log("missing  :", await check("/nope.txt"));
