/**
 * 催资源的标题归一化 / 与站内目录匹配
 *
 * 这一层把「两个标题算不算同一个」的规则收在一处：
 * 仓储去重、对话框的「已有 N 人催」、榜单的「已收录」都走这里，
 * 避免出现「对话框说没有、榜单却把它判成已收录」这种前后不一致。
 */
import type { Game } from '../types/game'

/**
 * 空白、Unicode 标点与符号。
 *
 * SQL 端的 `[[:space:][:punct:]]` 会去掉 `+`、`&` 这类 ASCII 符号；
 * 这里也去掉 `\p{S}`，让「Jolly+4」与「Jolly 4」在前后端得到同一个归一化值。
 * 非 ASCII 符号（例如 emoji）在两端不保证完全一致，但常见标题输入已对齐。
 */
const SPACE_OR_PUNCTUATION = /[\s\p{P}\p{S}]+/gu

/**
 * 标题归一化：NFKC → 小写 → 去掉空白、标点与符号。
 *
 * `'  Jolly  4!! '`、`'JOLLY-4'`、`'Jolly+4'` 都会得到 `jolly4`。
 * 全角字符经 NFKC 折叠，因此 `'ＪＯＬＬＹ－４'` 也是 `jolly4`。
 */
export function normalizeRequestTitle(value: string): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFKC').toLowerCase().replace(SPACE_OR_PUNCTUATION, '')
}

export function isSameRequestTitle(left: string, right: string): boolean {
  const a = normalizeRequestTitle(left)
  return a.length > 0 && a === normalizeRequestTitle(right)
}

/**
 * 精确命中：只比较归一化后的游戏标题。
 *
 * 对话框用它决定是否显示「站内已收录」—— 这里**不能**用包含匹配，
 * 否则「Jolly 4」会被含糊地算成「Jolly」。
 */
export function matchExactGameForTitle(title: string, games: Game[]): Game | undefined {
  const target = normalizeRequestTitle(title)
  if (!target) return undefined
  return games.find((game) => normalizeRequestTitle(game.title) === target)
}

function significantTokens(value: string): string[] {
  const tokens = value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
  if (!tokens) return []
  return [...new Set(tokens)].filter((token) => token.length >= 3)
}

/**
 * 「站内是否已有这条资源」的**展示 / 联想**匹配。
 *
 * 顺序：
 *   1. 归一化标题**完全相等**；
 *   2. 包含匹配，但短串至少 3 个字符（避免 `a` 命中所有作品）；
 *   3. 最后才做多词匹配：至少两个长度 ≥3 的词全部出现在
 *      标题 + 作者 + 系列 + 标签里，且至少一个出现在标题里。
 *
 * ⚠️ 包含匹配只适合「给你看看站内可能相关的作品」。
 * 榜单的「已收录」判定必须用 `matchFulfilledGameForTitle()`（只认精确标题），
 * 否则请求《Jolly》会被《Jolly 4》、《One Night at Flumpty's》会被续作
 * 误判成已收录，从而从待上传榜单里消失。
 */
export function matchGameForTitle(title: string, games: Game[]): Game | undefined {
  const target = normalizeRequestTitle(title)
  if (!target) return undefined

  let contained: Game | undefined

  for (const game of games) {
    const gameTitle = normalizeRequestTitle(game.title)
    if (!gameTitle) continue
    if (gameTitle === target) return game

    if (!contained) {
      const shorter = Math.min(gameTitle.length, target.length)
      if (
        shorter >= 3 &&
        (gameTitle.includes(target) || target.includes(gameTitle))
      ) {
        contained = game
      }
    }
  }

  if (contained) return contained

  const tokens = significantTokens(title)
  if (tokens.length < 2) return undefined

  for (const game of games) {
    const gameTitle = normalizeRequestTitle(game.title)
    if (!gameTitle) continue
    const haystack = normalizeRequestTitle(
      `${game.title} ${game.author} ${game.ipSeries} ${(game.tags ?? []).join(' ')}`,
    )
    const allTokensPresent = tokens.every((token) => haystack.includes(token))
    const titleOverlap = tokens.some((token) => gameTitle.includes(token))
    if (allTokensPresent && titleOverlap) return game
  }

  return undefined
}

/**
 * 榜单「已收录」的判定：**归一化标题完全相等**才算。
 *
 * 刻意不做包含 / 分词匹配 —— 请求《Jolly》时，站内已有《Jolly 4》
 * 并不代表管理员已经上传了前作。宁可让它继续留在待上传榜单上，
 * 也不能用相似标题把真实需求静默吞掉。
 */
export function matchFulfilledGameForTitle(title: string, games: Game[]): Game | undefined {
  return matchExactGameForTitle(title, games)
}

/** 催资源榜单的统一排序：票数降序，其次提交时间升序，最后 id 保证稳定 */
export function compareResourceRequests(
  a: { votes: number; createdAt: string; id: string },
  b: { votes: number; createdAt: string; id: string },
): number {
  return b.votes - a.votes || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** 返回排好序的副本，不修改调用方数组 */
export function sortResourceRequestsByPriority<T extends { votes: number; createdAt: string; id: string }>(
  requests: T[],
): T[] {
  return [...requests].sort(compareResourceRequests)
}
