/**
 * ============================================================================
 * 作品工厂 —— 新建一条作品所需的缺省值与 id 生成
 * ============================================================================
 * 本地仓储与远程仓储都要做同一件事：把一份 `GamePatch` 变成一条完整的新作品。
 * 两个实现各抄一份的话，迟早会分叉（比如一边的缺省 status 是 draft、另一边不是）。
 * 所以放在这里，两个仓储都从这里取。
 * ============================================================================
 */
import type { AdminGame } from '../types/admin'
import { normalizeGame } from './gameDefaults'

/** 真实的编辑时刻，不是伪造的日期 */
export function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 新建作品时的完整缺省值。
 *
 * ⚠️ `status` 这里是 `draft`，与 `normalizeGame` 的缺省值**刻意相反**，这不是笔误：
 *   - `normalizeGame` 把「旧数据没有 status」补成 `published` —— 不能因为加了个字段
 *     就把已经上线的内容藏起来；
 *   - 而**新建**的作品缺省是 `draft` —— 新建不该默认为「对外可见」。
 */
export function blankGame(): AdminGame {
  return {
    id: '',
    title: '',
    author: '',
    releaseYear: new Date().getFullYear(),
    ipSeries: '',
    engine: '',
    coverImage: '',
    bannerImage: '',
    gallery: [],
    videoUrl: undefined,
    description: '',
    downloads: [],
    metrics: { fakeViews: 0, score: 0 },
    shortDescription: '',
    altTitles: [],
    gameplayTypes: [],
    mechanics: [],
    tags: [],
    platforms: [],
    developmentStatus: 'unknown',
    relations: [],
    sourceUrl: '',
    status: 'draft',
    featured: false,
    archived: false,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    publishedAt: '',
  }
}

/** 由标题生成 ASCII slug 作为 id（与 db.json 现有 id 的形态一致） */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'game'
}

/** 生成不冲突的 id。全中文标题会退化为 game / game-2 …… */
export function uniqueId(games: AdminGame[], title: string): string {
  const taken = new Set(games.map((game) => game.id))
  const base = slugify(title)
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/** 把「要改的字段」变成一条完整的新作品。`updatedBy` 由仓储传入 */
export function createGameFrom(
  games: AdminGame[],
  patch: Partial<AdminGame>,
  updatedBy?: string,
): AdminGame {
  const title = typeof patch.title === 'string' ? patch.title : ''
  const stamp = nowIso()
  // 显式的 `status: undefined` 不能覆盖 blankGame 的 draft：
  // normalizeGame 会把缺失 status 补成 published（那是给旧数据的规则），
  // 于是「没传状态」的新作品会意外对外可见。
  const status = patch.status ?? 'draft'
  return normalizeGame({
    ...blankGame(),
    ...patch,
    status,
    id: uniqueId(games, title),
    createdAt: stamp,
    updatedAt: stamp,
    // 首次发布时记录发布时间；草稿 / 下线保持空字符串（不伪造日期）
    publishedAt:
      typeof patch.publishedAt === 'string' && patch.publishedAt
        ? patch.publishedAt
        : patch.status === 'published'
          ? stamp
          : '',
    ...(updatedBy ? { updatedBy } : {}),
  })
}

/**
 * 把改动作用到一条已有作品上（id 不可被覆盖）。
 *
 * `updatedBy`：**由仓储传入**的当前操作者（GitHub 账号）。本地模式没有账号，
 * 不传即可 —— 字段本来就是 optional，UI 会显示「—」，不伪造署名。
 */
export function applyPatch(
  game: AdminGame,
  patch: Partial<AdminGame>,
  updatedBy?: string,
): AdminGame {
  const stamp = nowIso()
  const firstPublish = patch.status === 'published' && game.status !== 'published'

  // id 不可被 patch 覆盖（类型上已经排除，这里再兜一次底）
  return normalizeGame({
    ...game,
    ...patch,
    // `GamePatch` 是 Partial，显式 undefined 在类型上合法。
    // 新字段的「清空」语义是空数组 / 空字符串 / unknown，不是 undefined；
    // 若把 undefined 直接 spread 进去，normalizeGame 会把它变成默认值，
    // 表现为「保存成功但关系 / 分类 / 开发状态凭空消失」。
    altTitles: patch.altTitles ?? game.altTitles,
    gameplayTypes: patch.gameplayTypes ?? game.gameplayTypes,
    mechanics: patch.mechanics ?? game.mechanics,
    platforms: patch.platforms ?? game.platforms,
    relations: patch.relations ?? game.relations,
    developmentStatus: patch.developmentStatus ?? game.developmentStatus,
    sourceUrl: patch.sourceUrl ?? game.sourceUrl,
    // 同上：status: undefined 不能把已有作品打回 normalizeGame 的 published 默认值
    status: patch.status ?? game.status,
    id: game.id,
    updatedAt: stamp,
    // 首次变成「已上线」时记录发布时间；之后重命名 / 改简介都不会覆盖它。
    // 从已上线 → 下线 → 再上线也保留首次发布时间（它回答的是「什么时候第一次发布」）。
    publishedAt:
      firstPublish && !game.publishedAt
        ? stamp
        : typeof patch.publishedAt === 'string'
          ? patch.publishedAt
          : game.publishedAt,
    ...(updatedBy ? { updatedBy } : { updatedBy: game.updatedBy }),
  })
}
