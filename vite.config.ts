import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * GitHub Pages 项目站点部署在子路径下：
 *   https://<user>.github.io/<repo>/
 * 因此构建时的 base 必须与仓库名一致，否则 index.html 里引用的
 * /assets/*.js、/images/*.svg 全部会 404。
 *
 * 这里按 command 区分：
 *   - build  → 子路径（与线上一致）
 *   - serve  → '/'，保证本地开发地址仍是 http://localhost:5173/
 * 好处：本地开发 URL 不被打乱，而生产产物已经带上正确前缀。
 * 所有资源路径统一经过 src/utils/asset.ts 的 assetUrl()（读 import.meta.env.BASE_URL）。
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/fnaf-fan-games-archive/' : '/',
  plugins: [vue()],
}))
