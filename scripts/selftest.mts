/**
 * 命令行自检入口：npm run selftest
 *
 * 复用 src/dev/ 下的两份断言集（与调试视图共用同一份实现），
 * 在无浏览器的环境下验证深模块的过滤 / 排序 / 分页 / 勾选行为是否准确。
 * 退出码非 0 表示存在失败断言，可直接接入 CI。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { useAdminGames } from '../src/composables/useAdminGames'
import { useGameLibrary } from '../src/composables/useGameLibrary'
import { runAdminAssertions } from '../src/dev/adminAssertions'
import { runLibraryAssertions, type Assertion } from '../src/dev/libraryAssertions'

/* ---------------------------------------------------------------------------
   静态守卫（源码规范）
   ---------------------------------------------------------------------------
   有些红线用行为断言抓不到 —— 比如「后台不许直接读 db.json」。
   这类规则只能扫源码，所以放在这里一起跑，同样进 CI、同样让构建失败。

   【为什么要去注释】不去的话，像 gameRepository.ts 里「禁止 import db.json」
   这句**文档**本身就会被当成违规命中 —— 守卫必须只扫真正的代码。
   --------------------------------------------------------------------------- */
// 相对本文件定位项目根目录，这样从任何 cwd 跑都能找到源码
// （本文件会被 esbuild 打包到 .tmp/selftest.mjs，所以上一级就是根目录）
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function collectSources(dir: string): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectSources(full))
    else if (/\.(ts|vue)$/.test(entry)) {
      out.push({
        // ⚠️ 一律用「相对项目根的 POSIX 路径」—— 用绝对路径的话，
        //    下面守卫里的白名单就得写死机器的盘符，换台机器就废了
        path: relative(PROJECT_ROOT, full).split(sep).join('/'),
        code: stripComments(readFileSync(full, 'utf8')),
      })
    }
  }
  return out
}

function guard(name: string, offenders: string[], expectation: string): Assertion {
  return {
    name,
    pass: offenders.length === 0,
    expected: expectation,
    actual: offenders.length > 0 ? offenders.join(', ') : '（无越界）',
  }
}

const SOURCES = collectSources(join(PROJECT_ROOT, 'src'))
const ADMIN_SCOPE = /^src\/(views\/admin|components\/admin)\//

/**
 * 测试夹具不受「只能实例化一次」约束 ——
 * 持久化契约（写入 → 新实例读得到、损坏退回出厂）**正是**靠创建隔离实例来验证的。
 * 业务代码则一条都不能例外。
 */
const TEST_SCOPE = /^src\/dev\//

/** 唯一允许读 db.json 的地方 —— 换成远程仓储后这条依然成立 */
const DB_ALLOWLIST = ['src/repositories/localGameRepository.ts']

/** 只有这些文件可以创建仓储实例（否则会出现两份互不相干的数据） */
const FACTORY_ALLOWLIST = [
  'src/repositories/localGameRepository.ts',
  'src/repositories/remoteGameRepository.ts',
  'src/repositories/index.ts',
]

const staticResults: Assertion[] = [
  guard(
    '静态守卫 · 只有仓储可以读 db.json',
    SOURCES.filter(
      (f) => /from\s+['"][^'"]*data\/db\.json['"]/.test(f.code) && !DB_ALLOWLIST.includes(f.path),
    ).map((f) => f.path),
    DB_ALLOWLIST.join(', '),
  ),
  guard(
    '静态守卫 · 后台视图不引仓储的具体实现',
    SOURCES.filter(
      (f) =>
        ADMIN_SCOPE.test(f.path) &&
        /from\s+['"][^'"]*repositories\/(local|remote)GameRepository/.test(f.code),
    ).map((f) => f.path),
    '只允许 import ../repositories 的当前实例',
  ),
  guard(
    '静态守卫 · 只有 repositories/index.ts 实例化仓储',
    SOURCES.filter(
      (f) =>
        /create(Local|Remote)GameRepository\s*\(/.test(f.code) &&
        !FACTORY_ALLOWLIST.includes(f.path) &&
        !TEST_SCOPE.test(f.path),
    ).map((f) => f.path),
    `${FACTORY_ALLOWLIST.join(', ')}（测试夹具除外）`,
  ),
]

const libraryResults = await runLibraryAssertions(useGameLibrary())
const adminResults = await runAdminAssertions(useAdminGames())

const GROUPS: { title: string; results: Assertion[] }[] = [
  { title: 'useGameLibrary（前台深模块）', results: libraryResults },
  { title: 'useAdminGames（后台深模块）', results: adminResults },
  { title: '静态守卫（源码规范）', results: staticResults },
]

let failed = 0

for (const group of GROUPS) {
  console.log('')
  console.log(`── ${group.title} ${'─'.repeat(Math.max(4, 44 - group.title.length))}`)

  for (const item of group.results) {
    const flag = item.pass ? 'PASS' : 'FAIL'
    console.log(`[${flag}] ${item.name}`)
    if (!item.pass) {
      console.log(`         期望: ${item.expected}`)
      console.log(`         实际: ${item.actual}`)
    }
  }

  const groupFailed = group.results.filter((item) => !item.pass).length
  failed += groupFailed
  console.log(`${group.title}: ${group.results.length - groupFailed}/${group.results.length} passed`)
}

const totalCount = GROUPS.reduce((sum, group) => sum + group.results.length, 0)

console.log('')
console.log(`Deep module self-test: ${totalCount - failed}/${totalCount} passed`)

if (failed > 0) {
  console.error(`\n${failed} 项断言失败`)
  process.exit(1)
}

console.log('ALL PASS')
