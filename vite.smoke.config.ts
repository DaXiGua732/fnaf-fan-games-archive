import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 冒烟测试专用构建配置（与生产构建 vite.config.ts 分离）
 *
 * 关键差异（都是为了保持产物恒定、可重复）：
 *  - publicDir: false        —— 不把 public/ 的占位图拷进临时目录
 *  - emptyOutDir: false      —— 不清空输出目录（避免触发沙箱的批量删除保护）
 *  - inlineDynamicImports    —— 内联所有动态 import，产物恒为单个 smoke.js，
 *                               因此即使不清空目录也不会产生残留 chunk
 */
export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  build: {
    ssr: 'scripts/smoke.ts',
    outDir: '.tmp/smoke-build',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
