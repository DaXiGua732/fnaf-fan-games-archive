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
import { runDataQualityAssertions } from '../src/dev/dataQualityAssertions'
import { runLibraryAssertions, type Assertion } from '../src/dev/libraryAssertions'
import { runFilterUrlAssertions } from '../src/dev/filterUrlAssertions'
import { runRequestAssertions } from '../src/dev/requestAssertions'
import { runStructuredDataAssertions } from '../src/dev/structuredDataAssertions'
import { runThemeAssertions } from '../src/dev/themeAssertions'
import { runViewCounterAssertions } from '../src/dev/viewCounterAssertions'

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
  'src/repositories/githubGameRepository.ts',
  'src/repositories/index.ts',
]

/** 催资源仓储同样只能装配一次；两个实现文件里只是函数声明，不是实例化 */
const REQUEST_FACTORY_ALLOWLIST = [
  'src/repositories/index.ts',
  'src/repositories/localResourceRequestRepository.ts',
  'src/repositories/supabaseResourceRequestRepository.ts',
]

/**
 * 主题色的唯一来源是 `src/styles/index.css` 里的 CSS 变量。
 * `.vue` 里写死 hex 会绕过整套主题（切夜间 / 换强调色时它不会变），
 * 所以要扫；`&#8594;` 这类 HTML 实体不算（负向后行断言排除 `&`）。
 */
const HEX_COLOR_IN_VUE = /(?<!&)#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/

/** 固定 Tailwind 调色板同样会绕过主题变量（semantic token 才是唯一出口） */
const FIXED_PALETTE_CLASS =
  /\b(?:bg|text|border|divide|ring|outline|placeholder|from|via|to|fill|stroke)-(?:red|blue|green|pink|purple|yellow|gray|grey|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)-\d{2,3}\b/

const INDEX_HTML = readFileSync(join(PROJECT_ROOT, 'index.html'), 'utf8')

/**
 * Supabase SQL 无法在本地执行（没有 psql / Docker），但它的安全边界必须可回归。
 * 这些守卫只检查「关键声明还在」：RLS、收回直接写权限、security definer + search_path、
 * 视图不暴露身份列、同名 open 请求唯一。真正执行仍由站长在 Supabase 控制台完成。
 */
const REQUEST_SQL = readFileSync(
  join(PROJECT_ROOT, 'supabase/resource_requests.sql'),
  'utf8',
)
  // 去掉 SQL 注释，避免「注释里写了 security definer」把守卫骗过去
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--.*$/gm, '')
const REQUEST_VIEW_BLOCK =
  REQUEST_SQL.match(/create or replace view public\.resource_request_board([\s\S]*?);/)?.[1] ??
  ''

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
        /from\s+['"][^'"]*repositories\/(local|github)GameRepository/.test(f.code),
    ).map((f) => f.path),
    '只允许 import ../repositories 的当前实例',
  ),
  guard(
    '静态守卫 · 只有 repositories/index.ts 实例化仓储',
    SOURCES.filter(
      (f) =>
        /create(Local|GitHub)GameRepository\s*\(/.test(f.code) &&
        !FACTORY_ALLOWLIST.includes(f.path) &&
        !TEST_SCOPE.test(f.path),
    ).map((f) => f.path),
    `${FACTORY_ALLOWLIST.join(', ')}（测试夹具除外）`,
  ),
  guard(
    '静态守卫 · 只有 repositories/index.ts 实例化催资源仓储',
    SOURCES.filter(
      (f) =>
        /create(Local|Supabase)ResourceRequestRepository\s*\(/.test(f.code) &&
        !REQUEST_FACTORY_ALLOWLIST.includes(f.path) &&
        !TEST_SCOPE.test(f.path),
    ).map((f) => f.path),
    `${REQUEST_FACTORY_ALLOWLIST.join(', ')}（测试夹具除外）`,
  ),
  guard(
    '静态守卫 · .vue 不写死颜色（必须走主题变量）',
    SOURCES.filter((f) => f.path.endsWith('.vue') && HEX_COLOR_IN_VUE.test(f.code)).map(
      (f) => f.path,
    ),
    '颜色只在 src/styles/index.css 与 useTheme 的语义 token 中定义',
  ),
  guard(
    '静态守卫 · .vue 不用固定 Tailwind 调色板',
    SOURCES.filter(
      (f) => f.path.endsWith('.vue') && FIXED_PALETTE_CLASS.test(f.code),
    ).map((f) => f.path),
    '使用 ink / paper / line / surface / accent / inverse 等语义色',
  ),
  guard(
    '静态守卫 · 前端不出现 service_role',
    SOURCES.filter((f) => /service_role/i.test(f.code)).map((f) => f.path),
    '只使用 anon public key；service_role 绝不能进入前端',
  ),
  guard(
    '静态守卫 · 主题启动脚本与 useTheme 使用同一组 key',
    ['fnaf-archive:theme-mode:v1', 'fnaf-archive:theme-accent:v1'].filter(
      (key) => !INDEX_HTML.includes(key),
    ),
    'index.html 的防闪白脚本必须读取与 useTheme 相同的 storage key',
  ),
  guard(
    'Supabase SQL · 两张请求表都启用 RLS',
    ['resource_requests', 'resource_request_votes'].filter(
      (table) =>
        !REQUEST_SQL.includes(`alter table public.${table} enable row level security;`),
    ),
    '两张表都必须 enable row level security',
  ),
  guard(
    'Supabase SQL · anon 没有直接写权限',
    ['resource_requests', 'resource_request_votes'].filter(
      (table) =>
        !REQUEST_SQL.includes(`revoke all on table public.${table} from anon, authenticated;`),
    ),
    'anon / authenticated 只能通过 security definer RPC 写入',
  ),
  guard(
    'Supabase SQL · 两个写函数都是 security definer 且固定 search_path',
    [
      (REQUEST_SQL.match(/security definer/g) ?? []).length < 2 ? 'security definer 不足 2 处' : '',
      (REQUEST_SQL.match(/set search_path = public/g) ?? []).length < 2
        ? 'set search_path = public 不足 2 处'
        : '',
    ].filter(Boolean),
    '提交 / 投票函数必须使用 security definer + set search_path = public',
  ),
  guard(
    'Supabase SQL · 公开视图不暴露身份与归一化列',
    [
      !/security_invoker = true/.test(REQUEST_VIEW_BLOCK) ? '视图缺少 security_invoker' : '',
      /created_by_client/.test(REQUEST_VIEW_BLOCK) ? '视图暴露了 created_by_client' : '',
      /normalized/.test(REQUEST_VIEW_BLOCK) ? '视图暴露了 normalized' : '',
    ].filter(Boolean),
    'resource_request_board 只暴露 id / title / votes / created_at / updated_at',
  ),
  guard(
    'Supabase SQL · 同名 open 请求有唯一索引',
    !/resource_requests_open_normalized_key[\s\S]*?where status = 'open';/.test(REQUEST_SQL)
      ? ['缺少 normalized + status=open 的唯一索引']
      : [],
    '并发提交同名请求时由唯一索引兜底',
  ),
]

const libraryResults = await runLibraryAssertions(useGameLibrary())
const adminResults = await runAdminAssertions(useAdminGames())
const structuredResults = await runStructuredDataAssertions()
const viewResults = await runViewCounterAssertions()
const themeResults = runThemeAssertions()
const requestResults = await runRequestAssertions()
const filterUrlResults = runFilterUrlAssertions()
const dataQualityResults = runDataQualityAssertions()

const GROUPS: { title: string; results: Assertion[] }[] = [
  { title: 'useGameLibrary（前台深模块）', results: libraryResults },
  { title: 'useAdminGames（后台深模块）', results: adminResults },
  { title: '资料质量检查（只读）', results: dataQualityResults },
  { title: '筛选 URL（解析 / 序列化 / 签名）', results: filterUrlResults },
  { title: '结构化资料（字段 / 词表 / 关系 / 仓储）', results: structuredResults },
  { title: '浏览量服务（Abacus + 降级）', results: viewResults },
  { title: '主题系统（模式 / 强调色）', results: themeResults },
  { title: '催资源（归一化 / 仓储 / Supabase）', results: requestResults },
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
