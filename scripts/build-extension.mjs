/**
 * ============================================================================
 * 构建浏览器扩展
 * ============================================================================
 * content script 不能直接使用 ES module（Chrome/Edge 的 content_scripts
 * 不支持 "type": "module"），所以用 esbuild 打成一个 IIFE：
 *
 *   extension/src/content.js  →  extension/dist/content.js
 *
 * 产物目录 extension/dist/ 就是「加载已解压扩展」时要选的目录，不纳入版本管理。
 * ============================================================================
 */
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXTENSION = resolve(ROOT, 'extension')
const DIST = resolve(EXTENSION, 'dist')

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })

await build({
  entryPoints: [resolve(EXTENSION, 'src/content.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'edge110'],
  outfile: resolve(DIST, 'content.js'),
  logLevel: 'warning',
})

await cp(resolve(EXTENSION, 'manifest.json'), resolve(DIST, 'manifest.json'))
await cp(resolve(EXTENSION, 'src/content.css'), resolve(DIST, 'content.css'))
await cp(resolve(EXTENSION, 'icons'), resolve(DIST, 'icons'), { recursive: true })

console.log('扩展已构建：extension/dist/（Chrome / Edge → 扩展页 → 加载已解压的扩展）')
