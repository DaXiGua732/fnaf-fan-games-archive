/**
 * 作品写入的事务计划（纯函数）。
 *
 * 两个仓储 adapter 共用这一份：校验、应用改动、检测关系变化、生成落盘 patch
 * 与提交摘要。adapter 只剩 transport —— 本地写 localStorage / 远程走 GitHub
 * Contents API 的 409 重放。
 *
 * 【为什么计划必须跑在「最新数据」上】
 * 远程 409 重试时会重读数据仓，所以计划在 `commit()` 回调里执行；
 * 本地实现直接对当前 store 执行。两者都不在调用方快照上做决定。
 */
import type { AdminGame, GamePatch } from '../types/admin'
import type { Taxonomy } from '../types/taxonomy'
import { applyPatch, createGameFrom } from './gameFactory'
import { buildGameWritePatch } from './gamePersistence'
import { validateGameWrite } from './gameRules'
import { inspectGameRelations, normalizeRelations, sameRelations } from './relations'

export interface GameWritePlan {
  /** 归一化后的目标条目 */
  game: AdminGame
  /** 写入后的完整目录 */
  games: AdminGame[]
  /** 需要合并进原始记录的字段；`null` 表示新建（整条写入） */
  writePatch: Record<string, unknown> | null
  /** git 提交摘要 */
  summary: string
  /** relations 是否被明确改动 */
  relationsChanged: boolean
}

export interface GameDeletePlan {
  games: AdminGame[]
  removed: AdminGame
  /** 顺带清理掉的反向关系条数（提交摘要用） */
  cleanedRelations: number
}

export interface GameWriteOptions {
  taxonomy: Taxonomy
  /** 当前 GitHub 账号；本地模式没有 */
  updatedBy?: string
}

function assertNoErrors(errors: string[]): void {
  if (errors.length > 0) throw new Error(errors.join('；'))
}

export function planCreateGame(
  games: AdminGame[],
  patch: GamePatch,
  options: GameWriteOptions,
): GameWritePlan {
  const game = createGameFrom(games, patch, options.updatedBy)
  assertNoErrors(validateGameWrite(patch, game, options.taxonomy))

  const nextGames = [game, ...games]
  // id 是创建时才生成的，所以关系校验必须放在它之后：
  // 否则「目标正好等于新 id」会被 normalizeRelations 当作自关联静默丢弃。
  assertNoErrors(inspectGameRelations(nextGames, game).errors)

  return {
    game,
    games: nextGames,
    writePatch: null,
    summary: `新增作品《${game.title || '未命名'}》`,
    relationsChanged: patch.relations !== undefined,
  }
}

export function planUpdateGame(
  games: AdminGame[],
  id: string,
  patch: GamePatch,
  options: GameWriteOptions,
): GameWritePlan & { writePatch: Record<string, unknown> } {
  const index = games.findIndex((game) => game.id === id)
  if (index === -1) {
    throw new Error(`找不到 id 为「${id}」的作品，可能已经被删掉了。`)
  }

  const current = games[index]
  const next = applyPatch(current, patch, options.updatedBy)
  assertNoErrors(validateGameWrite(patch, next, options.taxonomy))

  // 编辑器每次保存都会带上 relations；内容没变就不算「明确修改了关系」，
  // 落盘时沿用原始数组，避免把归一化丢掉的异常关系写没。
  const relationsChanged =
    patch.relations !== undefined &&
    !sameRelations(current.relations, normalizeRelations(patch.relations, id))

  const nextGames = games.map((game, itemIndex) => (itemIndex === index ? next : game))

  // 目录级校验只针对**明确修改过**的关系。历史数据里可能有悬挂 / 双端关系，
  // 它们不应阻塞标题、状态、归档等无关字段的保存。
  if (relationsChanged) {
    assertNoErrors(inspectGameRelations(nextGames, next).errors)
  }

  const fields = Object.keys(patch).join('、')
  return {
    game: next,
    games: nextGames,
    writePatch: buildGameWritePatch(current, next, patch, relationsChanged),
    summary: `更新《${next.title || id}》的 ${fields || '字段'}`,
    relationsChanged,
  }
}

/** 删除作品并清理所有指向它的入边；id 不存在时返回 null */
export function planDeleteGame(games: AdminGame[], id: string): GameDeletePlan | null {
  const removed = games.find((game) => game.id === id)
  if (!removed) return null

  let cleanedRelations = 0
  const nextGames = games
    .filter((game) => game.id !== id)
    .map((game) => {
      const relations = game.relations ?? []
      const kept = relations.filter((relation) => relation.targetId !== id)
      if (kept.length === relations.length) return game
      cleanedRelations += relations.length - kept.length
      return { ...game, relations: kept }
    })

  return { games: nextGames, removed, cleanedRelations }
}
