/**
 * 深模块接口断言集（开发期工具）
 *
 * 由 `scripts/selftest.mts` 消费（npm run selftest，CI 可复用）。
 * 断言集只保留一份，避免「浏览器里看到的自检」与命令行自检两处漂移。
 *
 * 【边界】这里只做「输入 → 期望输出」的行为断言，
 *         绝不重新实现过滤/排序逻辑（那属于深模块内部职责）。
 */
import { nextTick } from 'vue'
import { isPubliclyVisible, type GameLibraryAPI } from '../composables/useGameLibrary'
import { publicGameRepository } from '../repositories'
import { resolveVocabularyEntry } from '../utils/taxonomy'

export interface Assertion {
  name: string
  expected: string
  actual: string
  pass: boolean
}

/** 等待深模块内部的模拟加载完成 */
export async function settle(lib: Pick<GameLibraryAPI, 'isLoading'>): Promise<void> {
  await nextTick()
  let guard = 0
  while (lib.isLoading.value && guard < 200) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    guard += 1
  }
  await nextTick()
}


/**
 * 「按标题升序」这条规则的独立推导。
 *
 * ⚠️ 这里的断言**不能写死某个标题**。原先写死了 "Dayshift at Freddy's"，
 * 结果站长在后台把那条作品的标题改成了别的内容，测试就挂了 ——
 * 数据是随时会被改的（这正是这个后台存在的意义），断言不能把内容编码进去。
 * 要断言的是**排序规则**：首位应该是全部标题里 localeCompare 最小的那一个。
 */
function titleAsc(games: { title: string }[]): string[] {
  return games.map((game) => game.title).sort((a, b) => a.localeCompare(b, 'en'))
}

export async function runLibraryAssertions(lib: GameLibraryAPI): Promise<Assertion[]> {
  const results: Assertion[] = []

  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = String(actual)
    const e = String(expected)
    results.push({ name, expected: e, actual: a, pass: a === e })
  }

  // 1. 基线
  lib.clearFilters()
  lib.setSortBy('views')
  lib.setPageSize(12)
  await settle(lib)

  // ⚠️ 期望值一律从**当前数据**推导，不写死条数 / 作者 / 年份。
  //    部署前会 data:pull，CI 用的就是数据仓里那份随时会被后台改的数据；
  //    写死「6 款」这类断言会让部署在一个完全正常的编辑之后失败。
  const base = [...lib.filtered.value]
  const BASE = base.length

  /** 出现次数最多的作者 / 年份 / 系列 —— 用它做筛选，断言才有实际覆盖面 */
  function mostCommon<T, K>(items: T[], key: (item: T) => K): K {
    const counts = new Map<K, number>()
    for (const item of items) {
      const value = key(item)
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'en'),
    )[0][0]
  }

  const busiestAuthor = mostCommon(base, (game) => game.author)
  const authorCount = base.filter((game) => game.author === busiestAuthor).length
  const sample = base.find((game) => game.author === busiestAuthor)!
  const sampleYear = sample.releaseYear
  const crossCount = base.filter(
    (game) => game.author === busiestAuthor && game.releaseYear === sampleYear,
  ).length

  check('清除筛选后返回全量', lib.total.value, BASE)

  // 2. 单作者过滤
  lib.setFilter('author', busiestAuthor)
  await settle(lib)
  check(`作者 = ${busiestAuthor} 命中数`, lib.total.value, authorCount)
  check(
    '结果作者全部一致',
    [...new Set(lib.filtered.value.map((game) => game.author))].join(','),
    busiestAuthor,
  )

  // 3. 作者 × 年份 交叉过滤（组间 AND）
  lib.setFilter('year', String(sampleYear))
  await settle(lib)
  check('作者 × 年份交叉命中', lib.total.value, crossCount)
  check(
    '交叉结果的作者与年份都匹配',
    lib.filtered.value.every(
      (game) => game.author === busiestAuthor && game.releaseYear === sampleYear,
    ),
    true,
  )

  // 4. 同组内单选切换（再点一次同值应取消）
  lib.setFilter('year', String(sampleYear))
  await settle(lib)
  check('再次点击同一年份应取消该筛选', lib.total.value, authorCount)

  // 5. 年份过滤
  const busiestYear = mostCommon(base, (game) => game.releaseYear)
  const yearCount = base.filter((game) => game.releaseYear === busiestYear).length
  lib.clearFilters()
  lib.setFilter('year', String(busiestYear))
  await settle(lib)
  check(`年份 = ${busiestYear} 命中数`, lib.total.value, yearCount)

  // 6. 系列过滤
  const busiestSeries = mostCommon(base, (game) => game.ipSeries)
  const seriesCount = base.filter((game) => game.ipSeries === busiestSeries).length
  lib.clearFilters()
  lib.setFilter('series', busiestSeries)
  await settle(lib)
  check(`系列 = ${busiestSeries} 命中数`, lib.total.value, seriesCount)

  // 7. 模糊搜索：命中标题（大小写不敏感）
  //    用某条作品的完整标题当检索词 —— 它至少必须命中自己。
  const titleProbe = base[0].title
  lib.clearFilters()
  lib.setSearchQuery(titleProbe)
  await settle(lib)
  check('搜索完整标题至少命中自己', lib.filtered.value.some((game) => game.id === base[0].id), true)
  const lowerHits = lib.total.value
  lib.setSearchQuery(titleProbe.toUpperCase())
  await settle(lib)
  check('搜索大小写不敏感（命中数一致）', lib.total.value, lowerHits)

  // 8. 模糊搜索：命中作者 —— 至少该作者的每一条都要被搜到
  lib.setSearchQuery(busiestAuthor)
  await settle(lib)
  check(
    '搜索作者命中该作者的全部作品',
    base
      .filter((game) => game.author === busiestAuthor)
      .every((game) => lib.filtered.value.some((hit) => hit.id === game.id)),
    true,
  )

  // 9. 模糊搜索：命中引擎 —— 同理，至少该引擎的每一条都要被搜到
  const busiestEngine = mostCommon(base, (game) => game.engine)
  lib.setSearchQuery(busiestEngine)
  await settle(lib)
  check(
    '搜索引擎命中该引擎的全部作品',
    base
      .filter((game) => game.engine === busiestEngine)
      .every((game) => lib.filtered.value.some((hit) => hit.id === game.id)),
    true,
  )

  // 10. 检索词与筛选叠加
  lib.setFilter('author', busiestAuthor)
  await settle(lib)
  check(
    '搜索 + 作者筛选叠加后只剩该作者',
    lib.filtered.value.every((game) => game.author === busiestAuthor),
    true,
  )
  check('叠加后命中数不超过该作者总数', lib.total.value <= authorCount, true)

  // 11. 空结果
  lib.clearFilters()
  lib.setSearchQuery('zzzzz')
  await settle(lib)
  check('搜索 "zzzzz" 应返回 0 条', lib.total.value, 0)

  // 12. 排序 —— 断言规则，不写死标题
  lib.clearFilters()
  lib.setSortBy('title')
  await settle(lib)
  check('按首字母排序首位 = 标题升序首位', lib.games.value[0]?.title, titleAsc(lib.games.value)[0])

  lib.setSortBy('views')
  await settle(lib)
  check(
    '按热度排序首位取到最大浏览量',
    lib.games.value[0]?.metrics.fakeViews,
    Math.max(...base.map((game) => game.metrics.fakeViews)),
  )

  lib.setSortBy('year')
  await settle(lib)
  check(
    '按年份排序首位取到最新年份',
    lib.games.value[0]?.releaseYear,
    Math.max(...base.map((game) => game.releaseYear)),
  )

  lib.setSortBy('score')
  await settle(lib)
  check(
    '按评分排序首位取到最高分',
    lib.games.value[0]?.metrics.score,
    Math.max(...base.map((game) => game.metrics.score)),
  )

  // 13. 分页 —— 页数由总量推导
  lib.clearFilters()
  lib.setSortBy('views')
  lib.setPageSize(2)
  await settle(lib)
  const pageCount = Math.ceil(BASE / 2)
  check('每页 2 条 → 总页数', lib.totalPages.value, pageCount)
  check('第 1 页条数', lib.games.value.length, Math.min(2, BASE))
  check('第 1 页首条为热度最高', lib.games.value[0]?.metrics.fakeViews, Math.max(...base.map((game) => game.metrics.fakeViews)))

  lib.setPage(pageCount)
  await settle(lib)
  check('末页条数', lib.games.value.length, BASE - (pageCount - 1) * 2)
  check('末页页码', lib.currentPage.value, pageCount)

  // 14. 页码越界夹紧（不应出现空白页）
  lib.setPage(99)
  await settle(lib)
  check('页码上溢被夹紧到末页', lib.currentPage.value, pageCount)
  check('夹紧后仍有结果', lib.games.value.length, BASE - (pageCount - 1) * 2)

  // 15. getGameById
  const lookup = base[0]
  check('getGameById 命中', lib.getGameById(lookup.id)?.title, lookup.title)
  check('getGameById 未命中返回 undefined', lib.getGameById('not-exist'), 'undefined')

  // 16. 元数据 —— 去重数量与降序规则都从数据推导
  const uniqueAuthors = new Set(base.map((game) => game.author)).size
  const uniqueYears = [...new Set(base.map((game) => game.releaseYear))].sort((a, b) => b - a)
  check('可用作者数量', lib.availableAuthors.value.length, uniqueAuthors)
  check('可用年份数量（去重）', lib.availableYears.value.length, uniqueYears.length)
  check('年份降序排列', lib.availableYears.value.join(','), uniqueYears.join(','))

  /* ------------------------------------------- 16.5 多维查询 / URL / 失效条件（Phase 3） */
  lib.clearFilters()
  lib.setSortBy('views')
  lib.setPageSize(12)
  lib.hydrateFromQuery({})
  await settle(lib)

  // 标签：同维度 OR
  const tagCounts = new Map<string, number>()
  for (const game of base) {
    for (const tag of game.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const busiestTag =
    [...tagCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'),
    )[0]?.[0] ?? ''
  if (busiestTag) {
    lib.setFilter('tag', busiestTag)
    await settle(lib)
    check(
      `标签 = ${busiestTag} 命中数`,
      lib.total.value,
      base.filter((game) => (game.tags ?? []).includes(busiestTag)).length,
    )
  }

  // 引擎
  lib.clearFilters()
  lib.setFilter('engine', busiestEngine)
  await settle(lib)
  check(
    `引擎 = ${busiestEngine} 命中数`,
    lib.total.value,
    base.filter((game) => game.engine === busiestEngine).length,
  )

  // 年份：同维度多值 OR
  const twoYears = uniqueYears.slice(0, 2)
  lib.clearFilters()
  for (const year of twoYears) lib.setFilter('year', String(year))
  await settle(lib)
  check(
    '年份多选 · OR 命中数',
    lib.total.value,
    base.filter((game) => twoYears.includes(game.releaseYear)).length,
  )
  check(
    '年份多选 · 状态保留全部值',
    lib.activeFilters.value.year.join(','),
    twoYears.map(String).join(','),
  )

  // URL → 状态
  lib.clearFilters()
  lib.hydrateFromQuery({
    author: [busiestAuthor],
    year: [String(sampleYear)],
    sort: 'title',
    page: '1',
    future: 'ignored',
  })
  await settle(lib)
  check('URL 注入 · 作者', lib.activeFilters.value.author.join(','), busiestAuthor)
  check('URL 注入 · 年份', lib.activeFilters.value.year.join(','), String(sampleYear))
  check('URL 注入 · 排序', lib.activeFilters.value.sort, 'title')
  check('URL 注入 · 未知参数不外泄', 'future' in lib.toQueryParams(), false)
  check('URL 注入 · 交叉命中数', lib.total.value, crossCount)

  // 失效词条：保留条件、给出标记、不静默变成「显示全部」
  lib.clearFilters()
  lib.hydrateFromQuery({ gameplay: 'deleted-entry' })
  await settle(lib)
  check('失效词条 · 结果为空', lib.total.value, 0)
  check('失效词条 · 被标记', lib.invalidFilterChips.value.length, 1)
  check('失效词条 · valid=false', lib.invalidFilterChips.value[0]?.valid, false)
  check('失效条件 · 不静默显示全部', lib.total.value === BASE, false)
  lib.clearInvalidFilters()
  await settle(lib)
  check('清除失效条件 · 恢复全量', lib.total.value, BASE)

  // 索引链接：清空其他条件，只保留点击项，排序回默认
  lib.clearFilters()
  lib.setFilter('author', busiestAuthor)
  lib.setIndexFilter('series', busiestSeries)
  await settle(lib)
  check('索引链接 · 清空其他条件', lib.activeFilters.value.author.length, 0)
  check('索引链接 · 目标条件生效', lib.activeFilters.value.series.join(','), busiestSeries)
  check('索引链接 · 排序回到默认', lib.activeFilters.value.sort, 'views')

  // 默认值不写进 URL
  lib.clearFilters()
  lib.setSortBy('views')
  await settle(lib)
  check('默认状态 · URL 为空', Object.keys(lib.toQueryParams()).length, 0)

  // 筛选变化 → 页码回到 1
  lib.clearFilters()
  lib.setPageSize(1)
  lib.setPage(2)
  await settle(lib)
  lib.setFilter('author', busiestAuthor)
  check('筛选变化 · 页码回到 1', lib.activeFilters.value.page, 1)
  lib.setPageSize(12)
  lib.clearFilters()
  await settle(lib)

  /* ------------------------------------------- 16.6 过滤元数据只来自可见作品（Phase 4） */
  const usedVocabularyIds = (
    collection: 'gameplayTypes' | 'mechanics' | 'platforms',
  ): Set<string> => {
    const ids = new Set<string>()
    for (const game of base) {
      for (const value of game[collection] ?? []) {
        const entry = resolveVocabularyEntry(lib.taxonomy.value, collection, value)
        ids.add(entry?.id ?? value)
      }
    }
    return ids
  }
  const expectedVocabularyOptions = (
    collection: 'gameplayTypes' | 'mechanics' | 'platforms',
  ): string => {
    const used = usedVocabularyIds(collection)
    return lib.taxonomy.value[collection]
      .filter((entry) => used.has(entry.id))
      .map((entry) => entry.id)
      .join(',')
  }
  check(
    '可用玩法类型只含被可见作品使用的词条',
    lib.availableGameplayTypes.value.map((entry) => entry.id).join(','),
    expectedVocabularyOptions('gameplayTypes'),
  )
  check(
    '可用机制只含被可见作品使用的词条',
    lib.availableMechanics.value.map((entry) => entry.id).join(','),
    expectedVocabularyOptions('mechanics'),
  )
  check(
    '可用平台只含被可见作品使用的词条',
    lib.availablePlatforms.value.map((entry) => entry.id).join(','),
    expectedVocabularyOptions('platforms'),
  )

  const expectedTags = [...new Set(base.flatMap((game) => game.tags ?? []))].sort((a, b) =>
    a.localeCompare(b, 'zh'),
  )
  check('可用标签 = 可见作品标签去重排序', lib.availableTags.value.join(','), expectedTags.join(','))

  const expectedEngines = [...new Set(base.map((game) => game.engine))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  )
  check(
    '可用引擎 = 可见作品引擎去重排序',
    lib.availableEngines.value.join(','),
    expectedEngines.join(','),
  )

  /* ---------------------------------------------------------------- 17. 前台可见性联动 */
  // Phase 10：前台与后台读的是**同一份**数据，所以改一处就能观察到前台的实时反应。
  // Phase 11 起统一走仓储的写入方法 —— 这顺带也验证了「前台能看到仓储写进去的东西」。
  //
  // ⚠️ 实验必须用**一次性探针条目**，不能拿 db.json 里的真实作品做：
  //    仓储每次更新都会打上真实的 updatedAt，而某些后台断言（缺省排序）依赖
  //    「原有条目的 updatedAt 全为空」。用探针做完就删，既不污染数据也不会互相干扰。
  lib.clearFilters()
  lib.setSortBy('views')
  lib.setPageSize(12)
  await settle(lib)
  check('联动 · 起点前台可见数', lib.total.value, BASE)
  const TOTAL_BASE = lib.totalSize.value

  const probe = await publicGameRepository.createGame({
    title: 'Visibility Probe',
    author: 'Probe Author',
    releaseYear: 2030,
    ipSeries: 'Probe Series',
    // 新建缺省就是 draft —— 先验证「草稿前台不可见」
    status: 'draft',
  })
  await settle(lib)

  check('探针（草稿）· 前台列表看不到', lib.total.value, BASE)
  check('探针（草稿）· 详情页取不到', lib.getGameById(probe.id), undefined)
  check('探针（草稿）· Hero 的收录数不含它', lib.catalogSize.value, BASE)
  check('探针（草稿）· 收录总数含它', lib.totalSize.value, TOTAL_BASE + 1)
  check('探针（草稿）· 作者不进「可用作者」', lib.availableAuthors.value.includes('Probe Author'), false)
  check('探针（草稿）· 年份不进「可用年份」', lib.availableYears.value.includes(2030), false)

  await publicGameRepository.publishGame(probe.id)
  await settle(lib)
  check('探针（已上线）· 前台可见数 +1', lib.total.value, BASE + 1)
  check('探针（已上线）· 详情页能取到', Boolean(lib.getGameById(probe.id)), true)
  check('探针（已上线）· 作者进入「可用作者」', lib.availableAuthors.value.includes('Probe Author'), true)
  check('探针（已上线）· 年份进入「可用年份」', lib.availableYears.value.includes(2030), true)

  await publicGameRepository.unpublishGame(probe.id)
  await settle(lib)
  check('探针（已下线）· 前台列表看不到', lib.total.value, BASE)
  check('探针（已下线）· 详情页取不到（前台完全隐藏）', lib.getGameById(probe.id), undefined)

  await publicGameRepository.updateGame(probe.id, { status: 'published', archived: true })
  await settle(lib)
  check('探针（已归档但已上线）· 前台列表看不到', lib.total.value, BASE)
  check('探针（已归档）· 详情页取不到', lib.getGameById(probe.id), undefined)

  await publicGameRepository.updateGame(probe.id, { archived: false })
  await settle(lib)
  check('探针（取消归档）· 恢复可见', lib.total.value, BASE + 1)

  // 收尾：删掉探针，数据彻底复原（原有条目一个字段都没被动过）
  await publicGameRepository.deleteGame(probe.id)
  await settle(lib)
  check('收尾 · 前台恢复原可见数', lib.total.value, BASE)
  check('收尾 · 收录总数复原', lib.totalSize.value, TOTAL_BASE)
  check('收尾 · 探针已彻底移除', lib.getGameById(probe.id), undefined)
  check('收尾 · 可用作者复原', lib.availableAuthors.value.length, uniqueAuthors)
  check('收尾 · 可用年份复原', lib.availableYears.value.length, uniqueYears.length)
  check('收尾 · 原有条目仍可正常取到', lib.getGameById(lookup.id)?.title, lookup.title)

  /* ---------------------------------------------------------------- 18. 运行时整表同步 */
  // hydratePublicCatalog() 的落点就是仓储的 hydrate：整表替换内存目录，
  // 让 totalSize / catalogSize 立即按新数据重算。这里直接测这一步的行为。
  const snapshot = await publicGameRepository.listGames()
  publicGameRepository.hydrate(snapshot.slice(0, 1))
  check('hydrate · 整表替换后总数', lib.totalSize.value, 1)
  check(
    'hydrate · 可见数按新数据重算',
    lib.catalogSize.value,
    snapshot.slice(0, 1).filter(isPubliclyVisible).length,
  )
  publicGameRepository.hydrate(snapshot)
  check('hydrate · 恢复原快照', lib.totalSize.value, TOTAL_BASE)

  // 复原默认状态
  lib.setPageSize(12)
  lib.setSortBy('views')
  lib.clearFilters()
  await settle(lib)

  return results
}
