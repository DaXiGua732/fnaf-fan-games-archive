/**
 * 目录文档的内存形态：原始记录、归一化作品、身份问题与词表。
 *
 * 两个仓储 adapter 都需要同一件事：从「任意 JSON 记录」得到 UI 可用的
 * `AdminGame[]`，同时**保留原始记录**供持久化合并。以前各写一遍
 * `indexRecords` / `normalizeGames` / `findCatalogIdentityIssues` / `normalizeTaxonomy`，
 * 任何一边漏改都会让本地与远程对同一份数据产生不同判断。
 *
 * 这里只负责「读」：解析后的原始数组 → 内存文档。写入由 `utils/gameWrite` 的计划负责。
 */
import type { AdminGame } from '../types/admin'
import type { Game } from '../types/game'
import type { Taxonomy } from '../types/taxonomy'
import { normalizeGames } from '../utils/gameDefaults'
import { findCatalogIdentityIssues } from '../utils/gamePersistence'
import { isRecord } from '../utils/guards'
import { normalizeTaxonomy } from '../utils/taxonomy'

export interface CatalogDocument {
  /** 归一化后的作品，UI 与前台直接消费 */
  games: AdminGame[]
  /** 原始记录按 id 索引；持久化时未编辑的记录原样写回 */
  records: Map<string, Record<string, unknown>>
  /** 记录身份问题；非空时任何写入都必须拒绝 */
  identityIssues: string[]
  taxonomy: Taxonomy
  taxonomyIssues: string[]
}

/** 原始记录按 id 索引；非法 / 重复 id 不进入映射（写入会被整体拒绝） */
function indexRecords(rawGames: readonly unknown[]): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>()
  const seen = new Set<string>()
  for (const entry of rawGames) {
    if (!isRecord(entry)) continue
    const id = entry.id
    if (typeof id !== 'string' || !id.trim() || id !== id.trim() || seen.has(id)) continue
    seen.add(id)
    // 键保持原始 id：归一化不改 id，持久化时 `game.id` 才能命中该记录
    records.set(id, entry)
  }
  return records
}

export function buildCatalogDocument(
  rawGames: readonly unknown[],
  rawTaxonomy?: unknown,
): CatalogDocument {
  const normalized = normalizeTaxonomy(rawTaxonomy)
  return {
    records: indexRecords(rawGames),
    identityIssues: findCatalogIdentityIssues(rawGames),
    // 非对象记录无法归一化，但不在这里丢弃原始数组：写入已因身份问题被拒绝，
    // 读取侧只需要能展示其余合法记录即可。
    games: normalizeGames(rawGames.filter(isRecord) as unknown as Game[]),
    taxonomy: normalized.taxonomy,
    taxonomyIssues: normalized.issues,
  }
}

/** 归一化记录的直接落盘形态：新记录没有原始 JSON，只能整条写入 */
export function recordOf(game: AdminGame): Record<string, unknown> {
  return { ...game } as unknown as Record<string, unknown>
}
