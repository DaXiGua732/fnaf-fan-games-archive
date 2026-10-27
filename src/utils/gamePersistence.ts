/**
 * ============================================================================
 * 作品记录的持久化边界
 * ============================================================================
 * 读取与展示可以使用归一化结果（UI 不应该看到非法关系），但**持久化不能**：
 * 一次「只改标题」的保存如果写回整条归一化记录，就会顺带删掉原始数据里
 * 质量检查本来要报告的异常关系。那是不必要的数据损失，且管理员无法察觉。
 *
 * 所以写路径只承认两类内容：
 *   1. 本次调用**显式给出**的字段（`GamePatch`）；
 *   2. 仓储自己维护的字段（`updatedAt` / `updatedBy` / `publishedAt`）。
 *
 * 其余字段一律沿用数据仓里的原始 JSON —— 未编辑的作品甚至整条记录原样写回。
 * 本模块只提供纯函数，两个仓储共享同一套语义，避免各写一份而分叉。
 * ============================================================================
 */
import type { AdminGame, GamePatch } from '../types/admin'
import type { VocabularyCollection } from '../types/taxonomy'
import { isRecord } from './guards'
import { rawRelationTargetId } from './relations'

/**
 * 把一次「更新」折算成要合并进原始记录的字段。
 *
 * - `relations` 仅在**确实与当前归一化关系不同**时才写入：编辑器的
 *   `draftToPatch()` 每次保存都会带上 relations，不能以「patch 里有这个键」
 *   当作修改证据。
 * - `undefined` 在 `GamePatch` 里表示「本次不修改」；唯一例外是 `videoUrl`，
 *   它用 `undefined` 表达「清空」，序列化时该键会被移除。
 * - 时间戳与署名取自归一化后的 `next`，保证落盘值与 UI / 内存一致。
 */
export function buildGameWritePatch(
  current: AdminGame,
  next: AdminGame,
  patch: GamePatch,
  relationsChanged: boolean,
): Record<string, unknown> {
  const write: Record<string, unknown> = {}
  const values = next as unknown as Record<string, unknown>
  const patchValues = patch as Record<string, unknown>

  for (const key of Object.keys(patchValues)) {
    if (key === 'relations' && !relationsChanged) continue
    if (patchValues[key] === undefined && key !== 'videoUrl') continue
    write[key] = values[key]
  }

  write.updatedAt = next.updatedAt
  if (next.updatedBy !== undefined && next.updatedBy !== current.updatedBy) {
    write.updatedBy = next.updatedBy
  }
  if (next.publishedAt !== current.publishedAt) {
    write.publishedAt = next.publishedAt
  }
  return write
}

/**
 * 词表合并 / 删除时，只把受影响作品的**那一个分类字段**合并回原始记录。
 * 关系、简介等未参与本次操作的字段保持数据仓原样。
 */
export function buildVocabularyWritePatches(
  games: readonly AdminGame[],
  ids: readonly string[],
  collection: VocabularyCollection,
): Map<string, Record<string, unknown>> {
  const byId = new Map(games.map((game) => [game.id, game]))
  const writes = new Map<string, Record<string, unknown>>()
  for (const id of ids) {
    const game = byId.get(id)
    if (game) writes.set(id, { [collection]: game[collection] })
  }
  return writes
}

/**
 * 删除作品时，从一条**原始记录**里剔除指向目标的入边。
 * 没有可清理的入边时返回 `null`（让调用方保持原记录不动）。
 *
 * 只过滤 `relations` 一个字段：其他历史异常（未知关系类型、空目标）
 * 仍保留在原始数据里，交给质量检查继续报告，而不是借删除操作顺手改掉。
 */
export function removeRelationTarget(
  record: Record<string, unknown>,
  targetId: string,
): Record<string, unknown> | null {
  if (!Array.isArray(record.relations)) return null
  const kept = record.relations.filter(
    (relation) => rawRelationTargetId(relation) !== targetId,
  )
  return kept.length === record.relations.length ? null : { ...record, relations: kept }
}

/** 身份校验的消息要能看出「第几条、实际是什么」，不能只报“id 不合法” */
function describeIdentityValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '数组'
  return `类型 ${typeof value}`
}

/**
 * 检查作品数组的**记录身份**是否可靠。
 *
 * 写入路径按 id 定位原始记录；一旦 id 缺失、空白、带首尾空白或重复，
 * 就无法确定一条 patch 应该落在哪条原始 JSON 上。此时继续写会覆盖、复制
 * 或丢失未编辑的记录 —— 所以仓储必须在提交前整体拒绝，而不是猜。
 *
 * 返回空数组表示 id 齐全、唯一且格式稳定。
 */
export function findCatalogIdentityIssues(games: readonly unknown[]): string[] {
  const issues: string[] = []
  const firstIndexById = new Map<string, number>()

  games.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`games[${index}] 不是对象（实际为 ${describeIdentityValue(entry)}）`)
      return
    }
    const id = entry.id
    if (id === undefined) {
      issues.push(`games[${index}] 缺少 id`)
      return
    }
    if (typeof id !== 'string') {
      issues.push(`games[${index}] 的 id 不是字符串（实际为 ${describeIdentityValue(id)}）`)
      return
    }
    if (!id.trim()) {
      issues.push(`games[${index}] 的 id 为空白`)
      return
    }
    if (id !== id.trim()) {
      issues.push(`games[${index}] 的 id「${id}」首尾包含空白`)
      return
    }
    const firstIndex = firstIndexById.get(id)
    if (firstIndex !== undefined) {
      issues.push(`games[${index}] 的 id「${id}」与 games[${firstIndex}] 重复`)
      return
    }
    firstIndexById.set(id, index)
  })

  return issues
}

/** 统一的拒绝写入文案；失败时必须**零副作用**，所以调用方要在任何写操作之前抛出 */
export function catalogIdentityErrorMessage(issues: readonly string[]): string {
  const shown = issues.slice(0, 8)
  const rest = issues.length - shown.length
  return (
    '作品记录的身份不可靠，已拒绝写入，避免覆盖、复制或丢失原始数据。' +
    '请先在数据源（数据仓 db.json / 本机存档）中修复 id 后重试：' +
    shown.join('；') +
    (rest > 0 ? `；另有 ${rest} 项` : '')
  )
}
