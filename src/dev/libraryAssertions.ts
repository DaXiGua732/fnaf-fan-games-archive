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
  check('按首字母排序首位', lib.games.value[0]?.title, "Dayshift at Freddy's")

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

  // 复原默认状态
  lib.setPageSize(12)
  lib.setSortBy('views')
  lib.clearFilters()
  await settle(lib)

  return results
}
