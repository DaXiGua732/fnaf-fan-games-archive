/**
 * ============================================================================
 * useAdminGames —— 后台游戏目录的深模块 (Deep Module)
 * ============================================================================
 * 设计原则与前台 `useGameLibrary` 一致：向视图层隐藏数据的复杂性，只暴露极简接口。
 * 但**两者刻意不共用**：
 *   前台 useGameLibrary 是只读单例，只应看到 published 的作品；
 *   后台需要看到全部状态、需要勾选、需要写入。
 *   共享会在 Phase 10（前台只看 published）时直接冲突。
 *
 * 本模块内部负责：
 *   1. 读取数据源（当前是构建期静态 JSON；Phase 11 换成 Repository —— 只改 CATALOG 那一行）
 *   2. 字段归一化（缺省 status='published' / tags=[] / 空时间戳）
 *   3. 关键词搜索（标题 / 作者 / IP 系列 / 引擎 / 标签）
 *   4. 状态 × 作者 × 标签 交叉筛选（组间 AND）
 *   5. 排序（7 个键，主键相等时用标题兜底，保证顺序确定）
 *   6. 分页
 *   7. 勾选（跨页保持；表头全选只作用于当前页）
 *   8. 批量写入（上线 / 下线 / 归档 / 加减标签 / 改作者）—— 当前只写内存，见「批量写入」一节
 *   9. 单条保存 saveGame()（Phase 5 起）—— 组件唯一允许的「写单条」入口
 *  10. 标签级操作 renameTag / deleteTag（Phase 6 起）—— 本质是改所有引用该标签的作品
 *
 * 【铁律】`views/admin/*.vue` 只允许调用本模块暴露的方法并遍历 `games`，
 *         绝对禁止在 `.vue` 内手写 `.filter()` / `.sort()`，也禁止 import db.json。
 *
 * 【与 Phase 0 冻结接口的两处偏差】
 *   1. 未提供 `isLoading`。当前数据源是同步的构建期 JSON，任何「加载中」都是永远
 *      不会亮起的死分支；提供一个恒为 false 的标记只会让 UI 写出假的骨架屏。
 *      等 Phase 11 接入异步 Repository 时再补，那时候它才有真实语义。
 *   2. `StatusFilter` 从 `GameStatus | 'all'` 扩展为 `GameStatus | 'archived' | 'all'`。
 *      Phase 3 引入「归档」概念，而归档刻意**不复用 status**（归档一个草稿不该把它
 *      变成已下线，那会丢信息），因此需要独立的筛选档位。
 * ============================================================================
 */
import { computed, reactive, ref } from 'vue'
import { adminGameRepository } from '../repositories'
import type {
  AdminGame,
  AdminGameQuery,
  AdminSortKey,
  GamePatch,
  StatusFilter,
  StorageKind,
} from '../types/admin'
import { TAG_LIMITS, isValidTag, normalizeTag } from '../types/admin'
import type { GameStatus } from '../types/game'

/** 每页条数默认值（后台表格，比前台网格密，默认放宽到 20） */
const DEFAULT_PAGE_SIZE = 20

/* ---------------------------------------------------------------------------
   数据源 —— 只通过 GameRepository 访问（Phase 11 起）
   ---------------------------------------------------------------------------
   本文件**不直接碰数据源**：读走 `adminGameRepository` 的响应式快照，
   写走它的异步方法。**未登录时它是本地仓储，登录后换成远程数据仓** ——
   本文件对此一无所知，因为两者是同一个接口。

   写入落在哪里由仓储声明（`storage`），并原样带给 UI，
   绝不能让人以为「保存成功」就等于「线上已经是这样了」。
   --------------------------------------------------------------------------- */

const COMPARATORS: Record<AdminSortKey, (a: AdminGame, b: AdminGame) => number> = {
  // 时间戳是 ISO 8601 字符串，字典序即时间序；空字符串（未记录）在降序时排到最后
  updatedAt: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  createdAt: (a, b) => b.createdAt.localeCompare(a.createdAt),
  sortOrder: (a, b) => b.sortOrder - a.sortOrder,
  title: (a, b) => a.title.localeCompare(b.title, 'en'),
  releaseYear: (a, b) => b.releaseYear - a.releaseYear,
  views: (a, b) => b.metrics.fakeViews - a.metrics.fakeViews,
  score: (a, b) => b.metrics.score - a.metrics.score,
}

/* ---------------------------------------------------------------------------
   查询状态（模块级单例，全后台共享）
   --------------------------------------------------------------------------- */
const query = reactive<AdminGameQuery>({
  search: '',
  status: 'all',
  author: null,
  tag: null,
  sort: 'updatedAt',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
})

/**
 * 主排序键相等时的兜底。
 *
 * 有实际用途：当前数据里 `updatedAt` 全为空，缺省排序下所有条目主键相等。
 * 没有兜底就会退化成「db.json 数组顺序」，而那个顺序会随着用户往数组中间
 * 插入条目而变化（占位图编号也跟着变）。用标题兜底后，列表顺序是确定的。
 */
function compare(a: AdminGame, b: AdminGame): number {
  return COMPARATORS[query.sort](a, b) || a.title.localeCompare(b.title, 'en')
}

/* ---------------------------------------------------------------------------
   派生数据：过滤 → 排序 → 分页
   --------------------------------------------------------------------------- */
const filtered = computed<AdminGame[]>(() => {
  const needle = query.search.trim().toLowerCase()

  const hit = adminGameRepository.value.games.value.filter((game) => {
    // 归档是叠加维度：默认视图与三个状态视图都不含已归档条目，只有「已归档」看得到它们
    if (query.status === 'all') {
      if (game.archived) return false
    } else if (query.status === 'archived') {
      if (!game.archived) return false
    } else if (game.archived || game.status !== query.status) {
      return false
    }
    if (query.author !== null && game.author !== query.author) return false
    if (query.tag !== null && !game.tags.includes(query.tag)) return false
    if (needle) {
      const haystack = `${game.title} ${game.author} ${game.ipSeries} ${game.engine} ${game.tags.join(' ')}`
      if (!haystack.toLowerCase().includes(needle)) return false
    }
    return true
  })

  return hit.sort(compare)
})

const total = computed(() => filtered.value.length)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / Math.max(1, query.pageSize))),
)

/** 当前页（已夹紧到合法区间，避免过滤后页码越界出现空白页） */
const currentPage = computed(() => Math.min(query.page, totalPages.value))

/** 过滤 + 排序后已分页的最终展示数据 */
const games = computed<AdminGame[]>(() => {
  const size = Math.max(1, query.pageSize)
  const start = (currentPage.value - 1) * size
  return filtered.value.slice(start, start + size)
})

/* ---------------------------------------------------------------------------
   统计与元数据
   --------------------------------------------------------------------------- */
/**
 * 状态计数。
 *
 * 口径是**全目录**，不随搜索 / 作者 / 标签筛选变化 —— 它是「目录构成」的概览。
 * 如果跟着筛选一起变，用户就永远无法回答「全部 6 条里有多少是草稿」，
 * 而那恰恰是状态概览要回答的问题。
 *
 * 归档的处理：三个状态互斥、求和等于 `all`；`archived` 单独一档且**不计入 `all`** ——
 * 与列表筛选行为严格对应（默认视图看不到已归档条目，计数也就不该把它们算进「全部」）。
 */
const statusCounts = computed<Record<StatusFilter, number>>(() => {
  const counts: Record<StatusFilter, number> = {
    all: 0,
    draft: 0,
    published: 0,
    offline: 0,
    archived: 0,
  }
  for (const game of adminGameRepository.value.games.value) {
    if (game.archived) {
      counts.archived += 1
      continue
    }
    counts[game.status] += 1
    counts.all += 1
  }
  return counts
})

const availableAuthors = computed(() =>
  [...new Set(adminGameRepository.value.games.value.map((game) => game.author))].sort((a, b) => a.localeCompare(b, 'en')),
)

/**
 * 标签首次被后台引入的时间。
 *
 * 标签目前只是挂在游戏上的字符串数组，**没有独立存储**（计划书 Phase 14 才会建 tags 表）。
 * 所以数据源里既有的标签没有创建时间可言，这里只记录「本次会话里由后台操作首次引入」的标签。
 * 空字符串 = 数据源未记录 —— UI 渲染为「—」，不伪造日期。
 */
const tagCreatedAt = ref<Record<string, string>>({})

function rememberTag(tag: string): void {
  if (tagCreatedAt.value[tag]) return
  tagCreatedAt.value = { ...tagCreatedAt.value, [tag]: nowIso() }
}

function rememberTags(tags: string[]): void {
  for (const tag of tags) rememberTag(tag)
}

/** 全量标签：名称 + 使用次数 + 首次引入时间（按使用次数降序，同次数按名称升序） */
const allTags = computed(() => {
  const usage = new Map<string, number>()
  for (const game of adminGameRepository.value.games.value) {
    for (const tag of game.tags) usage.set(tag, (usage.get(tag) ?? 0) + 1)
  }
  return [...usage.entries()]
    .map(([name, count]) => ({
      name,
      usage: count,
      createdAt: tagCreatedAt.value[name] ?? '',
    }))
    .sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name, 'zh'))
})

const availableTags = computed(() => allTags.value.map((item) => item.name))

/* ---- 标签页（Phase 6）的搜索 ----
   放在深模块里而不是组件里：视图层禁止手写 .filter() / .sort()，搜索属于数据加工。 */
const tagSearch = ref('')

/** 标签页展示用的列表：应用搜索条件后的结果（空搜索 = 全部） */
const visibleTags = computed(() => {
  const needle = tagSearch.value.trim().toLowerCase()
  if (!needle) return allTags.value
  return allTags.value.filter((item) => item.name.toLowerCase().includes(needle))
})

function setTagSearch(value: string): void {
  tagSearch.value = value
}

function clearTagSearch(): void {
  tagSearch.value = ''
}

/** 按名称查单个标签（供删除确认等场景显示使用次数） */
function findTag(name: string): { name: string; usage: number; createdAt: string } | undefined {
  return allTags.value.find((item) => item.name === name)
}

/**
 * 标签候选：从已有标签里挑出「本条作品还没有的、且匹配输入的」。
 *
 * 放在深模块里而不是组件里 —— 视图层禁止手写 `.filter()`，
 * 而这是对**目录数据**的筛选（不是对本地输入做切分那种琐碎处理）。
 */
function suggestTags(needle: string, exclude: string[], limit = 12): string[] {
  const keyword = normalizeTag(needle).toLowerCase()
  const owned = new Set(exclude)
  return availableTags.value
    .filter((tag) => !owned.has(tag))
    .filter((tag) => (keyword ? tag.toLowerCase().includes(keyword) : true))
    .slice(0, limit)
}

const activeQuery = computed<AdminGameQuery>(() => ({ ...query }))

const hasActiveQuery = computed(
  () =>
    query.search.trim() !== '' ||
    query.status !== 'all' ||
    query.author !== null ||
    query.tag !== null,
)

/* ---------------------------------------------------------------------------
   查询操作
   --------------------------------------------------------------------------- */
function setSearchQuery(value: string): void {
  if (query.search === value) return
  query.search = value
  query.page = 1
}

function setStatusFilter(value: StatusFilter): void {
  if (query.status === value) return
  query.status = value
  query.page = 1
}

/** 传 null 显式清空；传与当前相同的值视为取消（与前台筛选面板同款交互） */
function setAuthorFilter(value: string | null): void {
  query.author = value === null || query.author === value ? null : value
  query.page = 1
}

function setTagFilter(value: string | null): void {
  query.tag = value === null || query.tag === value ? null : value
  query.page = 1
}

function setSortBy(key: AdminSortKey): void {
  if (query.sort === key) return
  query.sort = key
  query.page = 1
}

function setPage(page: number): void {
  if (!Number.isFinite(page)) return
  query.page = Math.min(Math.max(1, Math.floor(page)), totalPages.value)
}

function setPageSize(size: number): void {
  if (!Number.isFinite(size) || size < 1) return
  query.pageSize = Math.floor(size)
  query.page = 1
}

/** 清除全部筛选条件。**刻意不清除排序** —— 排序是显示偏好，不是筛选条件 */
function clearQuery(): void {
  query.search = ''
  query.status = 'all'
  query.author = null
  query.tag = null
  query.page = 1
}

/* ---------------------------------------------------------------------------
   勾选
   语义冻结（Phase 0 §8.2）：跨页保持；表头全选只作用于当前页可见行。
   Phase 3 的批量操作直接消费这个勾选集。
   --------------------------------------------------------------------------- */
const selectionIds = ref<string[]>([])
const selection = computed(() => new Set(selectionIds.value))
const selectedCount = computed(() => selectionIds.value.length)

/** 已选 id 的快照，供批量操作传参。返回副本，外部改动不会影响内部状态 */
const selectedIds = computed<string[]>(() => [...selectionIds.value])

function isSelected(id: string): boolean {
  return selection.value.has(id)
}

function toggleSelect(id: string): void {
  selectionIds.value = selection.value.has(id)
    ? selectionIds.value.filter((item) => item !== id)
    : [...selectionIds.value, id]
}

function clearSelection(): void {
  selectionIds.value = []
}

/**
 * 所选条目**共同拥有**的标签。
 *
 * 「批量移除标签」只应该列出真正可移除的标签：如果某个标签只有部分选中项拥有，
 * 把它列出来对另一部分就是空操作，只会误导用户。
 */
const selectedCommonTags = computed<string[]>(() => {
  const ids = new Set(selectionIds.value)
  if (ids.size === 0) return []
  const chosen = adminGameRepository.value.games.value.filter((game) => ids.has(game.id))
  if (chosen.length === 0) return []
  return allTags.value
    .map((item) => item.name)
    .filter((tag) => chosen.every((game) => game.tags.includes(tag)))
})

/** 当前页是否全部已选。无数据时为 false，避免表头出现误导性的「已全选」 */
const isPageFullySelected = computed(
  () => games.value.length > 0 && games.value.every((game) => selection.value.has(game.id)),
)

/** 半选态（有选中但不全选），驱动表头复选框的 indeterminate */
const isPagePartiallySelected = computed(
  () => !isPageFullySelected.value && games.value.some((game) => selection.value.has(game.id)),
)

/**
 * 表头复选框。
 * 只作用于**当前页可见行** —— 不是全库、也不是全部筛选结果，
 * 避免一次误点就把整站作品批量上线。
 */
function toggleSelectAllOnPage(): void {
  if (isPageFullySelected.value) {
    const idsOnPage = new Set(games.value.map((game) => game.id))
    selectionIds.value = selectionIds.value.filter((id) => !idsOnPage.has(id))
    return
  }
  const merged = new Set(selectionIds.value)
  for (const game of games.value) merged.add(game.id)
  selectionIds.value = [...merged]
}

/* ---------------------------------------------------------------------------
   单条读取
   --------------------------------------------------------------------------- */
function getGameById(id: string): AdminGame | undefined {
  return adminGameRepository.value.games.value.find((game) => game.id === id)
}

/* ---------------------------------------------------------------------------
   批量写入
   ---------------------------------------------------------------------------
   所有写入都走仓储，写入落在哪里由仓储声明（`BatchOutcome.storage`）并原样带给 UI。
   --------------------------------------------------------------------------- */

/** 一次批量操作的结果，供结果提示条展示 */
export interface BatchOutcome {
  /** 动作名称，如「批量下线」 */
  label: string
  /** 实际改动的条目数 */
  changed: number
  /** 无需改动而跳过的条目数（例如作品本来就已经是目标状态） */
  skipped: number
  /** 这次写入实际落在了哪里 —— UI 据此说出准确的那句话，见 STORAGE_NOTICE */
  storage: StorageKind
}

const lastOutcome = ref<BatchOutcome | null>(null)

/** 写入实际落在哪里（转自仓储）—— 页面据此**如实**说明数据现状，不写死文案 */
const storage = computed<StorageKind>(() => adminGameRepository.value.storage.value)

/**
 * 数据是否已经就绪。
 * 本地仓储恒为 true；**登录后换成远程仓，需要先把 db.json 拉下来** ——
 * 那段时间页面必须显示「加载中」，而不是显示一个空列表（那看起来就像数据全没了）。
 */
const ready = computed(() => adminGameRepository.value.ready.value)

/** 拉取失败的原因。空字符串表示正常 */
const loadError = computed(() => adminGameRepository.value.error.value)

/**
 * 清理「不再被任何作品引用」的旧上传图。
 *
 * 【为什么必须放在保存成功之后】
 * 上传那一刻，新图还没被任何作品引用，而旧图**仍然是线上正在用的那一张** ——
 * 那时删旧图等于把线上正在显示的图删掉。只有保存成功之后，
 * 「哪些图不再被引用」才有确定答案。
 *
 * 三条安全闸：
 *   1. 只清理数据仓 `images/games/` 下的图（仓储实现里再兜一道）
 *   2. 只清理**没有出现在任何作品里**的（包括刚保存的这条）
 *   3. 清理失败**绝不**让保存失败 —— git 历史里那份还在，顶多留一张废图
 *
 * 返回实际清理掉的张数，供提示条如实说明。
 */
async function cleanupOrphanImages(previous: string[], current: string[]): Promise<number> {
  const removed = previous.filter((url) => url && !current.includes(url))
  if (removed.length === 0) return 0

  // 收齐全库仍在使用的图片地址
  const inUse = new Set<string>()
  for (const game of await adminGameRepository.value.listGames()) {
    inUse.add(game.coverImage)
    inUse.add(game.bannerImage)
    for (const ref of game.gallery) inUse.add(ref)
  }

  let cleaned = 0
  for (const url of removed) {
    if (inUse.has(url)) continue
    try {
      await adminGameRepository.value.deleteImage(url)
      cleaned += 1
    } catch {
      // 不致命：顶多留下一张没人引用的废图，git 历史里也能找回
    }
  }
  return cleaned
}

/** 一条作品用到的全部图片地址 */
function imagesOf(game: AdminGame): string[] {
  return [game.coverImage, game.bannerImage, ...game.gallery].filter(Boolean)
}

/**
 * 上传一张图片到数据仓，返回它的**公开地址**。
 * 只有远程模式可用 —— 本地模式没有可写的远端，会抛错（调用方先看 `storage`）。
 */
function uploadImage(
  file: Blob,
  options: { gameId: string; slot: 'cover' | 'banner' | 'gallery' },
): Promise<string> {
  return adminGameRepository.value.uploadImage(file, options)
}

/** 重新拉取一次（给「加载失败 → 重试」用） */
function reload(): Promise<void> {
  return adminGameRepository.value.reload()
}

/**
 * 数据是否可用 —— 页面用它决定「渲染内容」还是「渲染加载/错误状态」。
 *
 * ⚠️ 必须用一个判断，而不是让页面各自写 `ready && !loadError`：
 * 漏掉一半就会出现「加载中却显示空列表」「出错却显示找不到该作品」这类误导。
 */
const dataOk = computed(() => ready.value && !loadError.value)

function dismissOutcome(): void {
  lastOutcome.value = null
}

/**
 * 恢复出厂数据：丢弃全部本地改动，回到 db.json 的内容。
 *
 * 这是**逃生舱**：本机存档一旦进入怪状态，用户得有办法退回去，
 * 而不是只能自己去清浏览器数据。会话级的标签元数据也一并清掉，
 * 否则会留下指向已不存在标签的创建时间。
 */
async function resetToSeed(): Promise<void> {
  await adminGameRepository.value.resetToSeed()
  tagCreatedAt.value = {}
  clearSelection()
  lastOutcome.value = null
}

/** 用于标记被改动条目的更新时间 —— 这是**真实**的编辑时刻，不是伪造的日期 */
function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 批量改写的统一入口。
 *
 * `mutate` 接收当前条目，返回**要写入的片段**；返回 `null` 表示「本来就符合目标状态」，
 * 会计入 skipped 而不是 changed —— 结果提示条要能如实反映「实际改了几条」，
 * 而不是把「选中了几条」当成「改了几条」。
 *
 * ⚠️ mutate 返回的是 `GamePatch` 而不是完整条目：`updatedAt` 由仓储统一打戳，
 * 调用方不该自己造时间戳。
 */
async function applyBatch(
  ids: string[],
  label: string,
  mutate: (game: AdminGame) => GamePatch | null,
): Promise<BatchOutcome> {
  let changed = 0
  let skipped = 0

  for (const id of ids) {
    const game = await adminGameRepository.value.getGame(id)
    // 不存在的 id 直接忽略：旧实现对「不在目录里的 id」也是静默跳过
    if (!game) continue

    const patch = mutate(game)
    if (patch === null) {
      skipped += 1
      continue
    }
    await adminGameRepository.value.updateGame(id, patch)
    changed += 1
  }

  // 语义冻结（Phase 0 §8.2）：执行后清空勾选，但**保留筛选条件与页码**
  clearSelection()

  const outcome: BatchOutcome = { label, changed, skipped, storage: adminGameRepository.value.storage.value }
  lastOutcome.value = outcome
  return outcome
}

/** 批量上线 / 下线 */
function batchSetStatus(ids: string[], status: GameStatus): Promise<BatchOutcome> {
  const label = status === 'published' ? '批量上线' : '批量下线'
  return applyBatch(ids, label, (game) => (game.status === status ? null : { status }))
}

/** 批量归档 / 取消归档。归档是独立标记，**不改发布状态** */
function batchSetArchived(ids: string[], archived: boolean): Promise<BatchOutcome> {
  const label = archived ? '批量归档' : '批量取消归档'
  return applyBatch(ids, label, (game) =>
    Boolean(game.archived) === archived ? null : { archived },
  )
}

/** 批量添加标签（已拥有该标签的条目会自动跳过，不产生重复标签） */
async function batchAddTags(ids: string[], tags: string[]): Promise<BatchOutcome> {
  const incoming = [...new Set(tags.map((tag) => normalizeTag(tag)).filter(isValidTag))]
  const outcome = await applyBatch(ids, '批量添加标签', (game) => {
    if (incoming.length === 0) return null
    // 与草稿态共用同一套上限，避免两条路径产出不符合约束的数据
    const room = TAG_LIMITS.maxPerGame - game.tags.length
    if (room <= 0) return null
    const missing = incoming.filter((tag) => !game.tags.includes(tag)).slice(0, room)
    if (missing.length === 0) return null
    return { tags: [...game.tags, ...missing] }
  })
  rememberTags(incoming)
  return outcome
}

/** 批量移除标签（不含该标签的条目会自动跳过） */
function batchRemoveTags(ids: string[], tags: string[]): Promise<BatchOutcome> {
  const removing = new Set(tags.map((tag) => normalizeTag(tag)).filter(Boolean))
  return applyBatch(ids, '批量移除标签', (game) => {
    if (removing.size === 0) return null
    const kept = game.tags.filter((tag) => !removing.has(tag))
    if (kept.length === game.tags.length) return null
    return { tags: kept }
  })
}

/** 批量修改作者 */
function batchSetAuthor(ids: string[], author: string): Promise<BatchOutcome> {
  const next = author.trim()
  return applyBatch(ids, '批量修改作者', (game) => {
    if (!next || game.author === next) return null
    return { author: next }
  })
}

/* ---------------------------------------------------------------------------
   标签级操作（Phase 6）
   ---------------------------------------------------------------------------
   标签没有独立存储，所以「重命名 / 删除标签」的本质是**改所有引用它的作品**。
   这两条都是可撤销的（数据本身没删），但会一次改动多条记录，因此走同一个结果提示通道。
   --------------------------------------------------------------------------- */

/** 重命名标签：改掉所有引用它的作品。目标名已存在时会合并去重，不产生重复标签 */
async function renameTag(from: string, to: string): Promise<BatchOutcome> {
  const previous = normalizeTag(from)
  const next = normalizeTag(to)

  if (!previous || !isValidTag(next) || previous === next) {
    const noop: BatchOutcome = { label: '重命名标签', changed: 0, skipped: 0, storage: adminGameRepository.value.storage.value }
    lastOutcome.value = noop
    return noop
  }

  let changed = 0
  for (const game of await adminGameRepository.value.listGames()) {
    if (!game.tags.includes(previous)) continue
    const renamed = game.tags.map((tag) => (tag === previous ? next : tag))
    // 合并去重：目标名可能本来就在这条作品上
    await adminGameRepository.value.updateGame(game.id, { tags: [...new Set(renamed)] })
    changed += 1
  }

  // 首次引入时间跟着标签走
  const carried = tagCreatedAt.value[previous]
  const rest = { ...tagCreatedAt.value }
  delete rest[previous]
  if (carried && !rest[next]) rest[next] = carried
  tagCreatedAt.value = rest
  if (!carried) rememberTag(next)

  const outcome: BatchOutcome = {
    label: `重命名标签「${previous}」→「${next}」`,
    changed,
    skipped: 0,
    storage: adminGameRepository.value.storage.value,
  }
  lastOutcome.value = outcome
  return outcome
}

/** 删除标签：从所有作品上摘掉该标签本身。**不会删除任何作品** */
async function deleteTag(tag: string): Promise<BatchOutcome> {
  const target = normalizeTag(tag)

  let changed = 0
  if (target) {
    for (const game of await adminGameRepository.value.listGames()) {
      if (!game.tags.includes(target)) continue
      await adminGameRepository.value.updateGame(game.id, {
        tags: game.tags.filter((item) => item !== target),
      })
      changed += 1
    }
  }

  const rest = { ...tagCreatedAt.value }
  delete rest[target]
  tagCreatedAt.value = rest

  const outcome: BatchOutcome = {
    label: `删除标签「${target}」`,
    changed,
    skipped: 0,
    storage: adminGameRepository.value.storage.value,
  }
  lastOutcome.value = outcome
  return outcome
}

/* ---------------------------------------------------------------------------
   单条保存（Phase 5）
   ---------------------------------------------------------------------------
   这是计划书 §Phase 5 要求的「统一接口 saveGame(game)」，也是组件唯一允许的
   写入单条数据的入口。Phase 12 接入本地仓储 / Phase 13 接入远程库时只换这里的实现。
   --------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   单条保存（Phase 5）
   ---------------------------------------------------------------------------
   这是计划书 §Phase 5 要求的「统一接口 saveGame(game)」，也是组件唯一允许的
   写入单条数据的入口。内部只做两件事：调仓储 + 记录标签首次引入时间。

   「新建时的缺省值」「id 由标题生成」「时间戳怎么打」都已经搬到仓储里 ——
   它们属于数据层，不该由业务层操心。
   --------------------------------------------------------------------------- */

/** 保存入参。有 id ⇒ 更新，无 id ⇒ 新建 */
export interface GameSaveInput {
  id?: string
  /** 本次要写入的字段；未列出的字段保持原值（新建时取仓储的缺省值） */
  patch: GamePatch
}

/** 一次保存的结果 */
export interface SaveOutcome {
  mode: 'created' | 'updated'
  /** 保存后的完整条目（含生成的 id 与时间戳） */
  game: AdminGame
  /** 本次写入落在了哪里 */
  storage: StorageKind
  /** 顺带清理掉的、不再被引用的旧上传图张数 */
  cleanedImages: number
}

/** 保存一条作品（新建或更新） */
async function saveGame(input: GameSaveInput): Promise<SaveOutcome> {
  const { id, patch } = input

  if (id) {
    // 先记下改之前的图片，保存成功后用它算「哪些旧图没人用了」
    const before = await adminGameRepository.value.getGame(id)

    // id 不存在时由仓储显式抛错，不静默新建一条
    const updated = await adminGameRepository.value.updateGame(id, patch)
    if (updated.tags.length) rememberTags(updated.tags)

    const cleanedImages = before
      ? await cleanupOrphanImages(imagesOf(before), imagesOf(updated))
      : 0

    return {
      mode: 'updated',
      game: updated,
      storage: adminGameRepository.value.storage.value,
      cleanedImages,
    }
  }

  const created = await adminGameRepository.value.createGame(patch)
  if (created.tags.length) rememberTags(created.tags)
  return {
    mode: 'created',
    game: created,
    storage: adminGameRepository.value.storage.value,
    cleanedImages: 0,
  }
}

/* ---------------------------------------------------------------------------
   对外暴露的极简接口
   --------------------------------------------------------------------------- */
export interface AdminGamesAPI {
  // —— 状态 ——
  /** 过滤、排序、分页后的最终展示数据 */
  games: typeof games
  /** 过滤 + 排序后但未分页的完整结果（计数 / 断言用） */
  filtered: typeof filtered
  total: typeof total
  totalPages: typeof totalPages
  currentPage: typeof currentPage

  // —— 统计与元数据 ——
  statusCounts: typeof statusCounts
  availableAuthors: typeof availableAuthors
  availableTags: typeof availableTags
  allTags: typeof allTags
  /** 标签页搜索 */
  tagSearch: typeof tagSearch
  visibleTags: typeof visibleTags
  setTagSearch: typeof setTagSearch
  clearTagSearch: typeof clearTagSearch
  findTag: typeof findTag
  /** 标签候选（本条作品还没有的、匹配输入的） */
  suggestTags: typeof suggestTags

  // —— 当前查询状态 ——
  activeQuery: typeof activeQuery
  hasActiveQuery: typeof hasActiveQuery

  // —— 查询操作 ——
  setSearchQuery: typeof setSearchQuery
  setStatusFilter: typeof setStatusFilter
  setAuthorFilter: typeof setAuthorFilter
  setTagFilter: typeof setTagFilter
  setSortBy: typeof setSortBy
  setPage: typeof setPage
  setPageSize: typeof setPageSize
  clearQuery: typeof clearQuery

  // —— 勾选 ——
  selectedCount: typeof selectedCount
  /** 已选 id 快照，供批量操作传参 */
  selectedIds: typeof selectedIds
  /** 所选条目共同拥有的标签（「批量移除标签」面板用） */
  selectedCommonTags: typeof selectedCommonTags
  isSelected: typeof isSelected
  toggleSelect: typeof toggleSelect
  toggleSelectAllOnPage: typeof toggleSelectAllOnPage
  clearSelection: typeof clearSelection
  isPageFullySelected: typeof isPageFullySelected
  isPagePartiallySelected: typeof isPagePartiallySelected

  // —— 批量写入 ——
  /** 最近一次批量操作的结果；null 表示没有待展示的结果 */
  lastOutcome: typeof lastOutcome
  dismissOutcome: typeof dismissOutcome
  /** 写入实际落在哪里 —— 页面据此如实说明数据现状 */
  storage: typeof storage
  /** 数据是否已就绪（远程仓要先拉取） */
  ready: typeof ready
  /** 拉取失败的原因，空串表示正常 */
  loadError: typeof loadError
  /** 重新拉取一次 */
  reload: typeof reload
  /** 上传图片到数据仓（仅远程模式） */
  uploadImage: typeof uploadImage
  /** 数据可用（既已就绪、又没出错）—— 页面据此二选一渲染 */
  dataOk: typeof dataOk
  /** 恢复出厂数据（丢弃全部本地改动） */
  resetToSeed: typeof resetToSeed
  batchSetStatus: typeof batchSetStatus
  batchSetArchived: typeof batchSetArchived
  batchAddTags: typeof batchAddTags
  batchRemoveTags: typeof batchRemoveTags
  batchSetAuthor: typeof batchSetAuthor

  // —— 单条保存 ——
  saveGame: typeof saveGame

  // —— 标签级操作 ——
  renameTag: typeof renameTag
  deleteTag: typeof deleteTag

  // —— 单条读取 ——
  getGameById: typeof getGameById
}

export function useAdminGames(): AdminGamesAPI {
  return {
    games,
    filtered,
    total,
    totalPages,
    currentPage,

    statusCounts,
    availableAuthors,
    availableTags,
    allTags,
    tagSearch,
    visibleTags,
    setTagSearch,
    clearTagSearch,
    findTag,
    suggestTags,

    activeQuery,
    hasActiveQuery,

    setSearchQuery,
    setStatusFilter,
    setAuthorFilter,
    setTagFilter,
    setSortBy,
    setPage,
    setPageSize,
    clearQuery,

    selectedCount,
    selectedIds,
    selectedCommonTags,
    isSelected,
    toggleSelect,
    toggleSelectAllOnPage,
    clearSelection,
    isPageFullySelected,
    isPagePartiallySelected,

    lastOutcome,
    dismissOutcome,
    storage,
    ready,
    loadError,
    reload,
    uploadImage,
    dataOk,
    resetToSeed,
    batchSetStatus,
    batchSetArchived,
    batchAddTags,
    batchRemoveTags,
    batchSetAuthor,

    saveGame,

    renameTag,
    deleteTag,

    getGameById,
  }
}
