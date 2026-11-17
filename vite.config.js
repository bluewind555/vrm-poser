import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * 开发期「保存模型到磁盘」中间件。
 *
 * 浏览器不能直接写用户磁盘，但 dev server 是本地 Node 进程，可以代劳：
 *   POST /__save-model?model=<目录名>&path=<相对路径>   原始二进制 body
 *   POST /__scan                                        重跑扫描、刷新 index.json
 *
 * 只允许写到 public/models/ 下面，并且拒绝路径穿越。
 * 注意：只在 `npm run dev` 下生效；纯静态部署时前端会退回浏览器收藏库。
 */
function modelSaverPlugin() {
  const modelsRoot = path.resolve('public/models');

  const safeJoin = (modelName, relPath) => {
    const cleanModel = String(modelName ?? '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/^\.+/, '');
    const rel = String(relPath ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .filter((seg) => seg && seg !== '.' && seg !== '..')
      .join('/');
    if (!cleanModel || !rel) return null;
    const modelDir = path.resolve(modelsRoot, cleanModel);
    const full = path.resolve(modelDir, rel);
    if (full !== modelDir && !full.startsWith(modelDir + path.sep)) return null;
    return full;
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 200 * 1024 * 1024) {
          reject(new Error('文件过大'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  return {
    name: 'vrm-poser-model-saver',
    configureServer(server) {
      server.middlewares.use('/__save-model', async (req, res) => {
        // GET 只用来探测"本地服务在不在"，不写文件
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, available: true }));
          return;
        }
        try {
          const url = new URL(req.url, 'http://localhost');
          const target = safeJoin(url.searchParams.get('model'), url.searchParams.get('path'));
          if (!target) {
            res.statusCode = 400;
            res.end('bad path');
            return;
          }
          const body = await readBody(req);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, body);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, bytes: body.length }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });

      server.middlewares.use('/__scan', (req, res) => {
        try {
          execFileSync(process.execPath, ['scripts/scan-models.mjs'], { cwd: process.cwd(), stdio: 'ignore' });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [modelSaverPlugin()],
  build: {
    // 不把 public/ 复制进 dist：
    // public/models 下有上百 MB 的第三方模型，每次构建都拷一份既慢又占地。
    // 静态服务器（scripts/serve-dist.mjs）会先查 dist、再回落到 public。
    copyPublicDir: false,
  },
});

