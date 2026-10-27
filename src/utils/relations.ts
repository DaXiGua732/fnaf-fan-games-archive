/**
 * 作品关系的方向、文案与校验
 *
 * 数据只存一条有向边：`{ type, targetId }` 写在「当前作品」上。
 * 目标页看到的反向文案由 `inverseRelationLabel()` 派生，绝不重复落库。
 *
 * 方向示例：
 *   A: { type: 'sequel', targetId: 'b' }  → A 是 B 的续作
 *   B 的详情页派生显示：前传：A
 */
import type { AdminGame } from '../types/admin'
import type { Game, GameRelation, RelationType } from '../types/game'
import { isRecord } from './guards'

export interface RelationTypeOption {
  type: RelationType
  /** 当前作品页上的文案 */
  label: string
  /** 目标作品页上的反向文案 */
  inverseLabel: string
}

/**
 * 顺序即后台下拉 / 前台展示的顺序。
 * `Record<RelationType, ...>` 的完整性由 `RELATION_TYPE_OPTIONS` 的类型保证。
 */
export const RELATION_TYPE_OPTIONS: RelationTypeOption[] = [
  { type: 'prequel', label: '前传', inverseLabel: '续作' },
  { type: 'sequel', label: '续作', inverseLabel: '前传' },
  { type: 'remake', label: '重制版', inverseLabel: '重制原作' },
  { type: 'reboot', label: '重启作品', inverseLabel: '重启原作' },
  { type: 'spin-off', label: '衍生作品', inverseLabel: '衍生作品' },
  { type: 'same-universe', label: '同一世界观', inverseLabel: '同一世界观' },
  { type: 'related', label: '相关作品', inverseLabel: '相关作品' },
]

const TYPE_LABELS = new Map(RELATION_TYPE_OPTIONS.map((item) => [item.type, item]))

/** 是否为合法的关系类型（运行时入参可能是脏数据） */
export function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && TYPE_LABELS.has(value as RelationType)
}

export function relationLabel(type: RelationType): string {
  return TYPE_LABELS.get(type)?.label ?? '相关作品'
}

export function inverseRelationLabel(type: RelationType): string {
  return TYPE_LABELS.get(type)?.inverseLabel ?? '相关作品'
}

/**
 * 结构归一化：丢弃未知类型、空目标、自关联与同一目标的重复项。
 *
 * ⚠️ 这里**不检查目标是否存在** —— 单条归一化时看不到整个目录。
 * 存在性 / 两端重复由 `validateGameRelations()` 在保存前检查。
 * 也**不做数量截断**：上限属于编辑器校验，归一化静默丢数据会让旧记录无故变少。
 */
export function normalizeRelations(input: unknown, selfId: string): GameRelation[] {
  if (!Array.isArray(input)) return []

  const result: GameRelation[] = []
  const seenTargets = new Set<string>()

  for (const raw of input) {
    if (!isRecord(raw)) continue
    const type = raw.type
    const targetId = typeof raw.targetId === 'string' ? raw.targetId.trim() : ''
    if (!isRelationType(type) || !targetId) continue
    if (selfId && targetId === selfId) continue
    if (seenTargets.has(targetId)) continue

    seenTargets.add(targetId)
    // 保留未知扩展字段，避免以后加 note / source 时被旧代码抹掉
    result.push({ ...raw, type, targetId } as GameRelation)
  }

  return result
}

/**
 * 校验「提交上来的原始关系数组」的形状。
 *
 * 为什么不能只依赖 normalizeRelations：
 * 它会把非法项**静默丢掉**。对读路径这是稳健；对写路径却会让
 * 「提交了一条非法关系」表现为「保存成功，但关系不见了」。
 * 所以写入前先用本函数拒绝，再做归一化。
 */
export function validateRelationInput(input: unknown, selfId = ''): string[] {
  if (!Array.isArray(input)) return ['关系数据必须是数组']

  const errors: string[] = []
  const seenTargets = new Set<string>()

  for (const raw of input) {
    if (!isRecord(raw)) {
      errors.push('关系数据格式不合法')
      continue
    }
    if (!isRelationType(raw.type)) {
      errors.push('关系类型不合法')
      continue
    }
    const targetId = typeof raw.targetId === 'string' ? raw.targetId.trim() : ''
    if (!targetId) {
      errors.push('关系目标不能为空')
      continue
    }
    if (selfId && targetId === selfId) {
      errors.push('不能关联到作品自身')
      continue
    }
    if (seenTargets.has(targetId)) {
      errors.push('同一目标不能重复关联')
      continue
    }
    seenTargets.add(targetId)
  }

  return [...new Set(errors)]
}

/** 关系检查结果：逐行错误 + 去重后的整体错误 */
export interface GameRelationInspection {
  /** 与 `game.relations` 一一对应的错误（空字符串 = 该行通过） */
  rowErrors: string[]
  /** 去重后的整体错误（仓储 / 汇总提示用） */
  errors: string[]
}

/**
 * 保存前 / 编辑时的关系检查。`games` 必须是完整目录（含草稿 / 下线）。
 *
 * 检查项：
 *   - 类型合法、目标非空、非自身
 *   - 目标存在于全部作品
 *   - 同一作品内同一目标只允许一条
 *   - 目标端已经记录过指向本作的关系 → 拒绝，避免两端各存一条
 *
 * 目标不可见（草稿 / 下线 / 归档）**不**在这里拒绝：
 * 关系可以存在，前台展示时再按可见性过滤。
 */
export function inspectGameRelations(
  games: AdminGame[],
  game: AdminGame,
): GameRelationInspection {
  const rowErrors: string[] = []
  const errors: string[] = []
  const byId = new Map(games.map((item) => [item.id, item]))
  const seenTargets = new Set<string>()

  for (const relation of game.relations ?? []) {
    let message = ''
    if (!isRelationType(relation.type)) {
      message = '关系类型不合法'
    } else {
      const targetId = relation.targetId.trim()
      if (!targetId) {
        message = '关系目标不能为空'
      } else if (game.id && targetId === game.id) {
        message = '不能关联到作品自身'
      } else if (seenTargets.has(targetId)) {
        message = '同一目标不能重复关联'
      } else {
        seenTargets.add(targetId)
        const target = byId.get(targetId)
        if (!target) {
          message = `关联目标不存在：${targetId}`
        } else {
          const back = (target.relations ?? []).find((item) => item.targetId === game.id)
          if (back) {
            message = `该关系已经记录在《${target.title}》上，请到那一侧编辑`
          }
        }
      }
    }

    rowErrors.push(message)
    if (message) errors.push(message)
  }

  return { rowErrors, errors: [...new Set(errors)] }
}

export function validateGameRelations(games: AdminGame[], game: AdminGame): string[] {
  return inspectGameRelations(games, game).errors
}

/** 当前作品页上的一条关系文案，例如「续作 · 《目标》」 */
export function relationText(type: RelationType, title: string): string {
  return `${relationLabel(type)} · 《${title}》`
}

/** 详情页「相关作品」的一条 */
export interface RelatedWork {
  game: Game
  /** 关系文案；同作者 / 同系列由分区标题表达，这里传空字符串 */
  label: string
}

/** 同作者 / 同系列最多展示多少条 */
export const RELATED_WORK_LIMIT = 6

function byYearThenTitle(a: RelatedWork, b: RelatedWork): number {
  return (
    b.game.releaseYear - a.game.releaseYear ||
    a.game.title.localeCompare(b.game.title, 'en')
  )
}

/**
 * 显式关系（有向边）→ 详情页条目。
 *
 * - 本作指向别人：用 `relationLabel(type)`；
 * - 别人指向本作：用 `inverseRelationLabel(type)` 派生，**不要求两端各存一条**；
 * - 只接受 `visibleGames` 里的目标，草稿 / 下线 / 归档不会经关联模块泄漏；
 * - 同一目标只出现一次（出边优先）。
 */
export function explicitRelatedWorks(
  visibleGames: Game[],
  current: Game,
): RelatedWork[] {
  const byId = new Map(visibleGames.map((game) => [game.id, game]))
  const seen = new Set<string>()
  const result: RelatedWork[] = []

  for (const relation of current.relations ?? []) {
    const target = byId.get(relation.targetId.trim())
    if (!target || target.id === current.id || seen.has(target.id)) continue
    seen.add(target.id)
    result.push({ game: target, label: relationLabel(relation.type) })
  }

  const incoming: RelatedWork[] = []
  for (const game of visibleGames) {
    if (game.id === current.id || seen.has(game.id)) continue
    const back = (game.relations ?? []).find((relation) => relation.targetId === current.id)
    if (!back) continue
    seen.add(game.id)
    incoming.push({ game, label: inverseRelationLabel(back.type) })
  }

  return [...result, ...incoming.sort(byYearThenTitle)]
}

function relatedByField(
  visibleGames: Game[],
  current: Game,
  field: 'author' | 'ipSeries',
  excludeIds: Iterable<string>,
  limit = RELATED_WORK_LIMIT,
): RelatedWork[] {
  const value = current[field]
  if (!value) return []

  const excluded = new Set<string>([current.id, ...excludeIds])
  return visibleGames
    .filter((game) => game.id !== current.id && !excluded.has(game.id) && game[field] === value)
    .map((game) => ({ game, label: '' }))
    .sort(byYearThenTitle)
    .slice(0, Math.max(0, limit))
}

/** 同一作者的其他作品（由标准字段派生，不要求管理员重复维护关系） */
export function sameAuthorWorks(
  visibleGames: Game[],
  current: Game,
  excludeIds: Iterable<string> = [],
  limit = RELATED_WORK_LIMIT,
): RelatedWork[] {
  return relatedByField(visibleGames, current, 'author', excludeIds, limit)
}

/** 同一 IP 系列的其他作品 */
export function sameSeriesWorks(
  visibleGames: Game[],
  current: Game,
  excludeIds: Iterable<string> = [],
  limit = RELATED_WORK_LIMIT,
): RelatedWork[] {
  return relatedByField(visibleGames, current, 'ipSeries', excludeIds, limit)
}
