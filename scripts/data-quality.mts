/**
 * 只读资料质量检查。
 *
 * 默认读构建快照 `src/data/db.json`，也可以用 `--file=` 指向任意 db.json
 * （例如从数据仓下载的副本）。**绝不写文件、绝不调用 GitHub API。**
 *
 *   npm run check:data
 *   npm run check:data -- --file=path/to/db.json
 *   npm run check:data -- --json
 *   npm run check:data -- --strict   # 有 error 时退出码 1；默认总是 0
 */
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { analyzeCatalog } from '../src/utils/dataQuality'

const DEFAULT_FILE = 'src/data/db.json'

function argumentValue(prefix: string): string {
  const hit = process.argv.find((arg) => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

const explicitFile = argumentValue('--file=')
const file = explicitFile || DEFAULT_FILE
const asJson = process.argv.includes('--json')
const strict = process.argv.includes('--strict')

let raw: unknown
try {
  raw = JSON.parse(readFileSync(resolve(file), 'utf8'))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`无法读取 ${file}：${message}`)
  process.exit(1)
}

const report = analyzeCatalog(raw, relative(process.cwd(), resolve(file)))

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const { counts } = report
  console.log(
    `资料质量检查 · ${report.source}` +
      (explicitFile
        ? ''
        : '（当前 checkout 的构建快照；是否为数据仓最新内容取决于最近一次 data:pull）'),
  )
  console.log(
    `作品 ${counts.games} 条（可见 ${counts.visible} / 隐藏 ${counts.hidden}） · ` +
      `词条 ${counts.taxonomyEntries} 个 · 未分类 ${counts.unclassified} 条`,
  )
  console.log(
    `error ${counts.errors} · warning ${counts.warnings} · info ${counts.infos}`,
  )

  const groups: { label: string; severity: 'error' | 'warning' | 'info' }[] = [
    { label: 'ERROR', severity: 'error' },
    { label: 'WARNING', severity: 'warning' },
    { label: 'INFO', severity: 'info' },
  ]
  for (const group of groups) {
    const items = report.issues.filter((issue) => issue.severity === group.severity)
    if (items.length === 0) continue
    console.log(`\n${group.label} (${items.length})`)
    for (const issue of items) {
      console.log(`  [${issue.code}] ${issue.message}`)
    }
  }

  if (report.unclassifiedGames.length > 0) {
    console.log('\n未分类作品')
    for (const game of report.unclassifiedGames) {
      console.log(`  ${game.id} · ${game.title || '（无标题）'}`)
    }
  }

  console.log(
    report.ok
      ? '\n结论：没有 error；warning / info 需要人工判断。'
      : '\n结论：存在 error，请在后台逐条修正（本工具不会改数据）。',
  )
}

process.exit(report.ok || !strict ? 0 : 1)
