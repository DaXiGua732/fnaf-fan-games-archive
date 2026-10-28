/**
 * 验证构建产物里的首帧主题脚本确实被内联了。
 *
 * 这一步只在 `vite build` 之后有意义：插件没跑 / 占位符写错时，
 * 页面会静默退回「先闪一下默认色」，单元测试抓不到，只有真实浏览器能看见。
 */
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
const problems = []

if (html.includes('<!--THEME_BOOT-->')) {
  problems.push('占位符未被替换：theme-boot 插件没有运行')
}
if (!html.includes('--accent-surface-rgb')) {
  problems.push('内联脚本缺少自定义强调色变量')
}

if (problems.length > 0) {
  console.error(`theme boot 检查失败：\n${problems.join('\n')}`)
  process.exit(1)
}

console.log('theme boot: inlined')
