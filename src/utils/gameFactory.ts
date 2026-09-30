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
    tags: [],
    platforms: [],
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
  return {
    ...blankGame(),
    ...patch,
    id: uniqueId(games, title),
    createdAt: stamp,
    updatedAt: stamp,
    ...(updatedBy ? { updatedBy } : {}),
  }
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
  // id 不可被 patch 覆盖（类型上已经排除，这里再兜一次底）
  return {
    ...game,
    ...patch,
    id: game.id,
    updatedAt: nowIso(),
    ...(updatedBy ? { updatedBy } : { updatedBy: game.updatedBy }),
  }
}
