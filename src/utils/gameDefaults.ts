/**
 * 领域模型缺省值归一化
 *
 * `db.json` 是单一事实来源，但它是**逐步演进**的：Phase 2 之前的数据没有
 * status / tags / updatedAt 等管理字段。本模块负责把这类「稀疏」数据补齐成
 * 后台可直接消费的 `AdminGame`，从而做到「新增字段零迁移」。
 *
 * 纯函数，不修改入参。
 */
import type { AdminGame } from '../types/admin'
import type { Game } from '../types/game'

/**
 * 单条归一化。
 *
 * 缺省值策略（Phase 0 冻结，两条都有明确理由）：
 *
 * 1. **`status` 缺省 `'published'`**
 *    db.json 里现有的 6 条数据全部是已上线作品。若缺省成 `'draft'`，
 *    等 Phase 10 的「前台只展示 published」一上线，整个前台会在一次提交里被清空 ——
 *    这是这个项目里最危险的一幕。缺省 `published` 则保证
 *    「数据里没有 status 字段」与「数据里写了 status: 'published'」渲染结果完全一致。
 *
 * 2. **时间戳缺省空字符串 `''`，而不是伪造日期**
 *    空字符串在 UI 上渲染为「—」，语义是「数据源尚未记录」。
 *    编造一个看起来合理的日期会让后台显示虚假信息，比显示「—」糟糕得多。
 */
export function normalizeGame(raw: Game): AdminGame {
  return {
    ...raw,
    shortDescription: raw.shortDescription ?? '',
    tags: raw.tags ?? [],
    platforms: raw.platforms ?? [],
    status: raw.status ?? 'published',
    featured: raw.featured ?? false,
    archived: raw.archived ?? false,
    sortOrder: raw.sortOrder ?? 0,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? '',
    publishedAt: raw.publishedAt ?? '',
  }
}

/** 批量归一化 */
export function normalizeGames(raw: Game[]): AdminGame[] {
  return raw.map(normalizeGame)
}
