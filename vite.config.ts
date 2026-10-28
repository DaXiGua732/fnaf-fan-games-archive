import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { buildSync } from 'esbuild'

const THEME_BOOT_PLACEHOLDER = '<!--THEME_BOOT-->'

/**
 * 把 `src/themeBoot.ts` 打包成 IIFE，内联进 index.html 的占位符。
 *
 * 为什么走构建而不是在 HTML 里手写：首帧脚本必须在 Vue 之前同步执行，
 * 但它与运行期 `useTheme` 必须是**同一份**读取 / 派生实现。
 * 手写一份等价脚本已经导致过「刷新前后颜色不一样」的隐患；
 * 现在 HTML 里只有占位符，实现只有 `src/theme/**` 一处。
 */
function themeBootPlugin(): Plugin {
  let root = ''
  return {
    name: 'theme-boot',
    configResolved(config) {
      root = config.root
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes(THEME_BOOT_PLACEHOLDER)) return html

        const result = buildSync({
          stdin: {
            contents: "import { bootTheme } from './src/themeBoot'\nbootTheme()",
            resolveDir: root,
            loader: 'ts',
            sourcefile: 'theme-boot-inline.ts',
          },
          bundle: true,
          format: 'iife',
          target: 'es2017',
          write: false,
          minify: true,
          legalComments: 'none',
          logLevel: 'silent',
        })
        const code = result.outputFiles[0]?.text ?? ''
        if (!code) throw new Error('theme-boot: 打包结果为空')

        // 内联脚本里出现 `</script>` 会提前闭合标签 —— 转义后再嵌入
        const safe = code.replace(/<\/script/gi, '<\\/script')
        return html.replace(THEME_BOOT_PLACEHOLDER, `<script>${safe}</script>`)
      },
    },
  }
}

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
  plugins: [vue(), themeBootPlugin()],
}))
