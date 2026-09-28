/**
 * 命令行自检入口：npm run selftest
 *
 * 复用 src/dev/libraryAssertions.ts 中的同一份断言集（与调试视图共用），
 * 在无浏览器的环境下验证 useGameLibrary 的过滤 / 排序 / 分页是否准确。
 * 退出码非 0 表示存在失败断言，可直接接入 CI。
 */
import { useGameLibrary } from '../src/composables/useGameLibrary'
import { runLibraryAssertions } from '../src/dev/libraryAssertions'

const lib = useGameLibrary()
const results = await runLibraryAssertions(lib)

const failed = results.filter((item) => !item.pass)

for (const item of results) {
  const flag = item.pass ? 'PASS' : 'FAIL'
  console.log(`[${flag}] ${item.name}`)
  if (!item.pass) {
    console.log(`         期望: ${item.expected}`)
    console.log(`         实际: ${item.actual}`)
  }
}

console.log('')
console.log(`Deep module self-test: ${results.length - failed.length}/${results.length} passed`)

if (failed.length > 0) {
  console.error(`\n${failed.length} 项断言失败`)
  process.exit(1)
}

console.log('ALL PASS')
