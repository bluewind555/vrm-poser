import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
// 先查构建产物，再回落到 public/（模型太大，不再复制进 dist）
const ROOTS = [path.join(projectRoot, 'dist'), path.join(projectRoot, 'public')];
const port = Number(process.env.PORT || 5280);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vrm': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.pmx': 'application/octet-stream',
  '.vmd': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tga': 'image/x-tga',
  '.svg': 'image/svg+xml',
};

function findFile(rel) {
  for (const root of ROOTS) {
    const file = path.join(root, rel);
    if (!file.startsWith(root)) continue; // 防目录穿越
    try {
      const st = fs.statSync(file);
      if (st.isFile()) return { file, st };
    } catch {
      /* 这个根下没有，继续找下一个 */
    }
  }
  return null;
}

http
  .createServer((req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const hit = findFile(rel);
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(hit.file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': hit.st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(hit.file).pipe(res);
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`static server on http://127.0.0.1:${port}/  (roots: dist → public)`),
  );
