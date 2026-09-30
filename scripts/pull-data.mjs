/**
 * 把数据仓的 db.json 同步到本地
 *
 * ============================================================================
 * 【为什么需要它 —— 这是两仓分离架构缺的那一环】
 * 后台写的是**数据仓**的 db.json，而前台读的是**构建期快照**（src/data/db.json）。
 * 两者之间必须有一次同步，前台才可能看到后台的改动。
 *
 *   npm run data:pull → 部署前由 deploy.yml 自动执行；本地开发可手动执行
 *
 * 【失败时怎么做】
 * 保留仓库里那份快照并**告警**，而不是把整个部署拦掉 ——
 * 一次网络抖动不应该让站点发不出去。但绝不写入一份校验不过的内容：
 * 宁可继续用旧快照，也不能把站点弄空。
 * ============================================================================
 */
import { writeFileSync } from 'node:fs'

const DATA_REPO = 'DaXiGua732/fnaf-fan-games-data'
const TARGET = 'src/data/db.json'

/**
 * 两个来源，按顺序试。
 *
 * raw 更快更直接；但在**受限网络**里可能不通（例如只放行 api.github.com 的沙箱）。
 * API 那条返回的是 base64 内容，需要多一步解码 —— 两条都拿到同样的东西。
 */
const SOURCES = [
  { url: `https://raw.githubusercontent.com/${DATA_REPO}/main/db.json`, kind: 'raw' },
  {
    url: `https://api.github.com/repos/${DATA_REPO}/contents/db.json?ref=main`,
    kind: 'api',
  },
]

/** 拉取一次数据仓的 db.json 原文；全部来源都失败时抛错 */
async function fetchRemoteText() {
  const problems = []

  for (const source of SOURCES) {
    try {
      const response = await fetch(source.url, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!response.ok) {
        problems.push(`${source.kind}: HTTP ${response.status}`)
        continue
      }
      if (source.kind === 'raw') return await response.text()

      // API 返回 { content: base64, sha }
      const payload = await response.json()
      return Buffer.from(String(payload.content).replace(/\n/g, ''), 'base64').toString('utf8')
    } catch (error) {
      problems.push(`${source.kind}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(problems.join(' / '))
}

function fail(message) {
  console.warn(`\n⚠️  数据同步失败：${message}`)
  console.warn('   已保留仓库里那份快照继续构建 —— 站点不会因此发布失败，')
  console.warn('   但这一次发布用的是**上一次同步到**的数据。\n')
  process.exit(0)
}

let text
try {
  text = await fetchRemoteText()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

// 校验：必须能解析、且有 games 数组。**校验不过绝不落盘** ——
// 一次把坏内容写进去，站点的全部数据就没了。
let games
try {
  games = JSON.parse(text)?.games
} catch {
  fail('拿到的不是合法 JSON')
}
if (!Array.isArray(games) || games.length === 0) {
  fail('拿到的 db.json 里没有 games 数组（或它是空的）')
}

writeFileSync(TARGET, `${JSON.stringify({ games }, null, 2)}\n`)
console.log(`✅ 已从数据仓同步 ${games.length} 条作品 → ${TARGET}`)
