import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // 不把 public/ 复制进 dist：
    // public/models 下有上百 MB 的第三方模型，每次构建都拷一份既慢又占地。
    // 静态服务器（scripts/serve-dist.mjs）会先查 dist、再回落到 public。
    copyPublicDir: false,
  },
});
