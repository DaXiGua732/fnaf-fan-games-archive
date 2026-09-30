/**
 * 深模块接口断言集（开发期工具）
 *
 * 同时被两处消费，保证「浏览器里看到的自检」与「命令行跑的自检」完全一致：
 *   - src/views/DebugLibrary.vue  （阶段二调试视图）
 *   - scripts/selftest.mts        （npm run selftest，CI 可复用）
 *
 * 【边界】这里只做「输入 → 期望输出」的行为断言，
 *         绝不重新实现过滤/排序逻辑（那属于深模块内部职责）。
 */
import { nextTick } from 'vue'
import type { GameLibraryAPI } from '../composables/useGameLibrary'
import { publicGameRepository } from '../repositories'

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
  check('清除筛选后返回全量', lib.total.value, 6)

  // 2. 单作者过滤
  lib.setFilter('author', 'Nikson')
  await settle(lib)
  check('作者 = Nikson 命中数', lib.total.value, 2)
  check(
    '结果作者全部为 Nikson',
    [...new Set(lib.filtered.value.map((g) => g.author))].join(','),
    'Nikson',
  )

  // 3. 作者 × 年份 交叉过滤（组间 AND）
  lib.setFilter('year', '2019')
  await settle(lib)
  check('作者 Nikson + 年份 2019 交叉命中', lib.total.value, 1)
  check('交叉命中标题', lib.filtered.value[0]?.title, 'The Joy of Creation: Story Mode')

  // 4. 同组内单选切换（再点一次同值应取消）
  lib.setFilter('year', '2019')
  await settle(lib)
  check('再次点击同一年份应取消该筛选', lib.total.value, 2)

  // 5. 年份过滤
  lib.clearFilters()
  lib.setFilter('year', '2015')
  await settle(lib)
  check('年份 = 2015 命中数', lib.total.value, 2)

  // 6. 系列过滤
  lib.clearFilters()
  lib.setFilter('series', '玩梗向混搭')
  await settle(lib)
  check('系列 = 玩梗向混搭 命中数', lib.total.value, 2)

  // 7. 模糊搜索：命中标题（大小写不敏感）
  lib.clearFilters()
  lib.setSearchQuery('FLUMPTY')
  await settle(lib)
  check('搜索 "FLUMPTY"（标题命中 / 大小写不敏感）', lib.total.value, 1)

  // 8. 模糊搜索：命中作者
  lib.setSearchQuery('kane')
  await settle(lib)
  check('搜索 "kane"（作者命中）', lib.total.value, 1)

  // 9. 模糊搜索：命中引擎
  lib.setSearchQuery('unreal')
  await settle(lib)
  check('搜索 "unreal"（引擎命中）', lib.total.value, 2)

  // 10. 检索词与筛选叠加
  lib.setFilter('author', 'Nikson')
  await settle(lib)
  check('搜索 unreal + 作者 Nikson 叠加', lib.total.value, 2)

  // 11. 空结果
  lib.clearFilters()
  lib.setSearchQuery('zzzzz')
  await settle(lib)
  check('搜索 "zzzzz" 应返回 0 条', lib.total.value, 0)

  // 12. 排序
  lib.clearFilters()
  lib.setSortBy('title')
  await settle(lib)
  // 断言规则本身，而不是写死某个标题 —— 数据是会被改的，见 titleAsc 说明
  check('按首字母排序首位 = 标题升序首位', lib.games.value[0]?.title, titleAsc(lib.games.value)[0])

  lib.setSortBy('views')
  await settle(lib)
  check('按热度排序首位', lib.games.value[0]?.title, "One Night at Flumpty's")

  lib.setSortBy('year')
  await settle(lib)
  check('按年份排序首位', lib.games.value[0]?.title, 'The Joy of Creation: Story Mode')

  lib.setSortBy('score')
  await settle(lib)
  check('按评分排序首位', lib.games.value[0]?.title, "One Night at Flumpty's")

  // 13. 分页
  lib.clearFilters()
  lib.setSortBy('views')
  lib.setPageSize(2)
  await settle(lib)
  check('每页 2 条 → 总页数', lib.totalPages.value, 3)
  check('第 1 页条数', lib.games.value.length, 2)
  check('第 1 页首条为热度最高', lib.games.value[0]?.title, "One Night at Flumpty's")

  lib.setPage(3)
  await settle(lib)
  check('第 3 页条数', lib.games.value.length, 2)
  check('第 3 页页码', lib.currentPage.value, 3)

  // 14. 页码越界夹紧（不应出现空白页）
  lib.setPage(99)
  await settle(lib)
  check('页码上溢被夹紧到末页', lib.currentPage.value, 3)
  check('夹紧后仍有结果', lib.games.value.length, 2)

  // 15. getGameById
  check('getGameById 命中', lib.getGameById('popgoes')?.title, 'POPGOES')
  check('getGameById 未命中返回 undefined', lib.getGameById('not-exist'), 'undefined')

  // 16. 元数据
  check('可用作者数量', lib.availableAuthors.value.length, 5)
  check('可用年份数量（去重）', lib.availableYears.value.length, 4)
  check('年份降序排列', lib.availableYears.value.join(','), '2019,2017,2016,2015')

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
  check('联动 · 起点前台可见 6 款', lib.total.value, 6)

  const probe = await publicGameRepository.createGame({
    title: 'Visibility Probe',
    author: 'Probe Author',
    releaseYear: 2030,
    ipSeries: 'Probe Series',
    // 新建缺省就是 draft —— 先验证「草稿前台不可见」
    status: 'draft',
  })
  await settle(lib)

  check('探针（草稿）· 前台列表看不到', lib.total.value, 6)
  check('探针（草稿）· 详情页取不到', lib.getGameById(probe.id), undefined)
  check('探针（草稿）· Hero 的收录数不含它', lib.catalogSize.value, 6)
  check('探针（草稿）· 作者不进「可用作者」', lib.availableAuthors.value.includes('Probe Author'), false)
  check('探针（草稿）· 年份不进「可用年份」', lib.availableYears.value.includes(2030), false)

  await publicGameRepository.publishGame(probe.id)
  await settle(lib)
  check('探针（已上线）· 前台可见 7 款', lib.total.value, 7)
  check('探针（已上线）· 详情页能取到', Boolean(lib.getGameById(probe.id)), true)
  check('探针（已上线）· 作者进入「可用作者」', lib.availableAuthors.value.includes('Probe Author'), true)
  check('探针（已上线）· 年份进入「可用年份」', lib.availableYears.value.includes(2030), true)

  await publicGameRepository.unpublishGame(probe.id)
  await settle(lib)
  check('探针（已下线）· 前台列表看不到', lib.total.value, 6)
  check('探针（已下线）· 详情页取不到（前台完全隐藏）', lib.getGameById(probe.id), undefined)

  await publicGameRepository.updateGame(probe.id, { status: 'published', archived: true })
  await settle(lib)
  check('探针（已归档但已上线）· 前台列表看不到', lib.total.value, 6)
  check('探针（已归档）· 详情页取不到', lib.getGameById(probe.id), undefined)

  await publicGameRepository.updateGame(probe.id, { archived: false })
  await settle(lib)
  check('探针（取消归档）· 恢复可见', lib.total.value, 7)

  // 收尾：删掉探针，数据彻底复原（原有 6 条一个字段都没被动过）
  await publicGameRepository.deleteGame(probe.id)
  await settle(lib)
  check('收尾 · 前台恢复 6 款', lib.total.value, 6)
  check('收尾 · 探针已彻底移除', lib.getGameById(probe.id), undefined)
  check('收尾 · 可用作者复原', lib.availableAuthors.value.length, 5)
  check('收尾 · 可用年份复原', lib.availableYears.value.length, 4)
  check('收尾 · 原有条目仍可正常取到', lib.getGameById('popgoes')?.title, 'POPGOES')

  // 复原默认状态
  lib.setPageSize(12)
  lib.setSortBy('views')
  lib.clearFilters()
  await settle(lib)

  return results
}
