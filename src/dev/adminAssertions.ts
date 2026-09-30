/**
 * 后台深模块接口断言集（开发期工具）
 *
 * 与 `libraryAssertions.ts` 同款设计：断言集只写一份，被命令行（`npm run selftest`）消费，
 * 保证「浏览器里的自检」与「命令行自检」不会两处漂移。
 *
 * 【边界】这里只做「输入 → 期望输出」的行为断言，
 *         绝不重新实现过滤 / 排序 / 分页 / 勾选逻辑（那属于深模块内部职责）。
 */
import { nextTick } from 'vue'
import {
  YEAR_RANGE,
  draftToPatch,
  emptyDraft,
  gameToDraft,
  useAdminGameDraft,
  validateDownload,
  validateDraft,
} from '../composables/useAdminGameDraft'
import type { AdminGamesAPI } from '../composables/useAdminGames'
import { publicGameRepository } from '../repositories'
import { aspectWarning, checkImageSize } from '../utils/imageInspect'
import { createGitHubGameRepository } from '../repositories/githubGameRepository'
import { decodeBase64, encodeBase64 } from '../services/githubApi'
import {
  STORAGE_KEY,
  createLocalGameRepository,
  type StorageLike,
} from '../repositories/localGameRepository'
import { IMAGE_LIMITS, DOWNLOAD_LIMITS, TAG_LIMITS, isValidImageRef, isValidTag, isLocalPreviewUrl, normalizeTag } from '../types/admin'
import type { AdminGame } from '../types/admin'
import type { Assertion } from './libraryAssertions'

/**
 * 后台深模块的数据源是同步的（构建期 JSON），没有模拟延迟，
 * 因此只需等一次 tick 让 computed 落地，不需要像前台那样轮询 isLoading。
 */
async function settle(): Promise<void> {
  await nextTick()
}

/**
 * 假的 GitHub Contents API。
 *
 * 只实现这个项目真正用到的那一次读、一次写，外加一个关键能力：
 * **制造一次 409 冲突，并在这期间让「别的管理员」改了另一条作品**。
 * 这样才能验证最要紧的那条性质 —— 重放自己的改动时，
 * 不能把别人刚保存的东西覆盖掉。
 */
async function createRemoteStub(): Promise<{
  putCount: number
  conflictCount: number
  conflictOnce: boolean
  lastPutSha: string
  lastPutMessage: string
  restore: () => void
}> {
  const originalFetch = globalThis.fetch
  const initial = await publicGameRepository.listGames()

  let content = JSON.stringify({ games: initial }, null, 2)
  let sha = 'sha-1'

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  const state = {
    putCount: 0,
    conflictCount: 0,
    conflictOnce: false,
    lastPutSha: '',
    lastPutMessage: '',
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {


    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as {
        content: string
        sha?: string
        message: string
      }
      state.lastPutSha = body.sha ?? ''
      state.lastPutMessage = body.message

      // ⚠️ 按路径区分：只有 db.json 才是「服务器上的数据」。
      //    图片上传写的是另一个文件，绝不能拿它去覆盖数据内容 ——
      //    否则后续读取会把一张 JPEG 当成 JSON 解析。
      if (!String(_input).endsWith('/db.json')) {
        state.putCount += 1
        return json({ content: { sha: 'sha-image' } })
      }

      if (state.conflictOnce) {
        state.conflictOnce = false
        state.conflictCount += 1
        // 模拟「别的管理员正好在这一刻保存了另一条作品」——服务器内容与 sha 都变了
        const parsed = JSON.parse(content) as { games: { id: string; author: string }[] }
        const peer = parsed.games.find((game) => game.id === 'tjoc-reborn')
        if (peer) peer.author = '被别的管理员改过'
        content = JSON.stringify(parsed, null, 2)
        sha = 'sha-after-conflict'
        return json({ message: 'sha 不匹配' }, 409)
      }

      // 不带 sha = 新建文件（真实 GitHub 也允许）；带了就必须对得上
      if (body.sha !== undefined && body.sha !== sha) return json({ message: 'sha 不匹配' }, 409)

      content = decodeBase64(body.content)
      sha = `sha-${state.putCount + 2}`
      state.putCount += 1
      return json({ content: { sha } })
    }

    return json({ content: encodeBase64(content), sha })
  }) as typeof fetch

  return state
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

export async function runAdminAssertions(lib: AdminGamesAPI): Promise<Assertion[]> {
  const results: Assertion[] = []

  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = String(actual)
    const e = String(expected)
    results.push({ name, expected: e, actual: a, pass: a === e })
  }

  /* ---------------------------------------------------------------- 1. 基线 */
  lib.clearQuery()
  lib.setSortBy('updatedAt')
  lib.setPageSize(20)
  lib.clearSelection()
  await settle()
  check('清除条件后返回全量', lib.total.value, 6)
  check('目录总数（statusCounts.all）', lib.statusCounts.value.all, 6)

  /* ------------------------------------------------------- 2. 状态计数与筛选 */
  check('状态计数 · 已上线', lib.statusCounts.value.published, 6)
  check('状态计数 · 草稿', lib.statusCounts.value.draft, 0)
  check('状态计数 · 已下线', lib.statusCounts.value.offline, 0)
  check('状态计数 · 已归档（归档不计入「全部」）', lib.statusCounts.value.archived, 0)

  lib.setStatusFilter('published')
  await settle()
  check('状态 = 已上线 命中数', lib.total.value, 6)

  lib.setStatusFilter('draft')
  await settle()
  check('状态 = 草稿 命中数（数据里没有 draft）', lib.total.value, 0)
  check('状态 = 草稿 时列表为空', lib.games.value.length, 0)

  lib.setStatusFilter('archived')
  await settle()
  check('状态 = 已归档 命中数（数据里没有 archived）', lib.total.value, 0)

  /* ---------------------------------------------- 3. 缺省排序的确定性兜底 */
  lib.setStatusFilter('all')
  await settle()
  // updatedAt 字段当前全为空 → 主键全部相等 → 退化为按标题升序。
  // 这条断言的意义是锁定「顺序确定，不依赖 db.json 数组位置」这个契约。
  // ⚠️ 断言默认排序的**完整规则**：updatedAt 降序，同值时按标题升序。
  //    不要写成「等于标题升序」—— 那隐含了「updatedAt 全为空」这个前提，
  //    而数据一旦被后台编辑过（updatedAt 有值），前提就没了，断言跟着假失败。
  //    （CI 上真实发生过：本地全绿、部署却挂，因为 CI 同步的是数据仓里已被编辑过的数据。）
  const byDefault = [...lib.games.value].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, 'en'),
  )
  check(
    '缺省排序 = updatedAt 降序（同值按标题升序）',
    lib.games.value.map((game) => game.title).join('|'),
    byDefault.map((game) => game.title).join('|'),
  )

  /* ---------------------------------------------------------------- 4. 排序 */
  lib.setSortBy('title')
  await settle()
  check('按名称排序首位 = 标题升序首位', lib.games.value[0]?.title, titleAsc(lib.games.value)[0])

  lib.setSortBy('releaseYear')
  await settle()
  check('按发行年份排序首位', lib.games.value[0]?.title, 'The Joy of Creation: Story Mode')

  lib.setSortBy('views')
  await settle()
  check('按热度排序首位', lib.games.value[0]?.title, "One Night at Flumpty's")

  lib.setSortBy('score')
  await settle()
  check('按评分排序首位', lib.games.value[0]?.title, "One Night at Flumpty's")

  /* ---------------------------------------------------------------- 5. 搜索 */
  lib.setSortBy('updatedAt')
  lib.setSearchQuery('FLUMPTY')
  await settle()
  check('搜索 "FLUMPTY"（标题命中 / 大小写不敏感）', lib.total.value, 1)

  lib.setSearchQuery('unreal')
  await settle()
  check('搜索 "unreal"（引擎命中）', lib.total.value, 2)

  /* ------------------------------------------------------ 6. 作者 / 标签筛选 */
  lib.setSearchQuery('')
  lib.setAuthorFilter('Nikson')
  await settle()
  check('作者 = Nikson 命中数', lib.total.value, 2)
  check(
    '结果作者全部为 Nikson',
    [...new Set(lib.filtered.value.map((game) => game.author))].join(','),
    'Nikson',
  )

  lib.setAuthorFilter('Nikson')
  await settle()
  check('再次点击同一作者应取消该筛选', lib.total.value, 6)

  // 当前数据里没有任何标签：这里断言的是「空标签数据集下筛选行为正确」
  check('availableTags 为空（数据尚未写入 tags）', lib.availableTags.value.length, 0)
  lib.setTagFilter('3D')
  await settle()
  check('按不存在的标签筛选应返回 0 条', lib.total.value, 0)
  lib.setTagFilter('3D')
  await settle()
  check('再次点击同一标签应取消', lib.total.value, 6)

  /* ------------------------------------------------------------ 7. 组合筛选 */
  lib.setStatusFilter('published')
  lib.setSearchQuery('flumpty')
  await settle()
  check('状态已上线 + 搜索 "flumpty" 叠加', lib.total.value, 1)

  /* ---------------------------------------------------------------- 8. 分页 */
  lib.setStatusFilter('all')
  lib.setSearchQuery('')
  lib.setPageSize(2)
  await settle()
  check('每页 2 条 → 总页数', lib.totalPages.value, 3)
  check('第 1 页条数', lib.games.value.length, 2)

  lib.setPage(3)
  await settle()
  check('第 3 页条数', lib.games.value.length, 2)
  check('第 3 页页码', lib.currentPage.value, 3)

  lib.setPage(99)
  await settle()
  check('页码上溢被夹紧到末页', lib.currentPage.value, 3)
  check('夹紧后仍有结果', lib.games.value.length, 2)

  lib.setPageSize(Number.NaN)
  check('非法每页条数被忽略（保持原值）', lib.activeQuery.value.pageSize, 2)

  /* ---------------------------------------------------------------- 9. 勾选 */
  lib.setPage(1)
  lib.clearSelection()
  await settle()
  check('初始未选择任何项', lib.selectedCount.value, 0)
  check('表头非全选态', lib.isPageFullySelected.value, false)
  check('表头非半选态', lib.isPagePartiallySelected.value, false)
  check('当前页条数（每页 2 条）', lib.games.value.length, 2)

  const firstId = lib.games.value[0]!.id
  lib.toggleSelect(firstId)
  check('勾选 1 项后的计数', lib.selectedCount.value, 1)
  check('该行被标记为已选', lib.isSelected(firstId), true)
  check('此时表头为半选态', lib.isPagePartiallySelected.value, true)
  check('此时表头不是全选态', lib.isPageFullySelected.value, false)

  lib.toggleSelectAllOnPage()
  check('对半选页执行表头全选 → 补齐当前页', lib.selectedCount.value, 2)
  check('表头变为全选态', lib.isPageFullySelected.value, true)
  check('表头不再是半选态', lib.isPagePartiallySelected.value, false)

  // 跨页保持：翻页不清空已选
  lib.setPage(2)
  await settle()
  check('翻页后已选数量保持不变', lib.selectedCount.value, 2)
  check('第 2 页表头为非全选态', lib.isPageFullySelected.value, false)

  lib.toggleSelect(lib.games.value[0]!.id)
  check('跨页累计选择', lib.selectedCount.value, 3)

  // 表头全选只作用于当前页：不会误伤第 1 页的选择
  lib.toggleSelectAllOnPage()
  check('第 2 页执行全选后累计', lib.selectedCount.value, 4)
  lib.toggleSelectAllOnPage()
  check('第 2 页取消全选后，仅移除第 2 页的 2 项', lib.selectedCount.value, 2)

  lib.clearSelection()
  check('清空选择', lib.selectedCount.value, 0)

  /* ------------------------------------------------------- 10. 单条读取 */
  check('getGameById 命中', lib.getGameById('popgoes')?.title, 'POPGOES')
  check('getGameById 未命中返回 undefined', lib.getGameById('not-exist'), 'undefined')

  /* ---------------------------------------------------------- 11. 元数据 */
  check('可用作者数量', lib.availableAuthors.value.length, 5)

  check(
    '缺省 status 已归一化为 published',
    lib.getGameById('tjoc-reborn')?.status,
    'published',
  )
  check('缺省 tags 已归一化为空数组', lib.getGameById('tjoc-reborn')?.tags.length, 0)
  check('缺省 updatedAt 为空字符串（不伪造日期）', lib.getGameById('tjoc-reborn')?.updatedAt, '')

  /* ------------------------------------------------ 12. 批量写入（会改数据） */
  // 说明：本段会**真实修改**内存中的条目，因此放在所有只读断言之后。
  //       段落收尾会把数据恢复原状，避免污染后续（未来更长的）断言序列。
  const TARGETS = ['tjoc-reborn', 'popgoes']

  /** 批量操作都需要先勾选，且每次执行后勾选会被自动清空 */
  function select(ids: string[]): void {
    lib.clearSelection()
    for (const id of ids) lib.toggleSelect(id)
    check(`已勾选 ${ids.length} 项`, lib.selectedCount.value, ids.length)
  }

  lib.setStatusFilter('all')
  lib.setSearchQuery('')
  lib.setPageSize(20)
  await settle()

  // —— 批量下线 ——
  select(TARGETS)
  await lib.batchSetStatus(TARGETS, 'offline')
  check('批量下线 · 动作名', lib.lastOutcome.value?.label, '批量下线')
  check('批量下线 · 实际改动数', lib.lastOutcome.value?.changed, 2)
  check('批量下线 · 跳过数', lib.lastOutcome.value?.skipped, 0)
  // selftest 跑在 Node 里，没有 localStorage → 仓储如实降级为「只写内存」
  check('批量下线 · 写入位置如实上报', lib.lastOutcome.value?.storage, 'memory')
  check('批量执行后自动清空勾选', lib.selectedCount.value, 0)
  check('批量下线后 · 已上线计数', lib.statusCounts.value.published, 4)
  check('批量下线后 · 已下线计数', lib.statusCounts.value.offline, 2)
  check('批量下线后 · 前台可见条目的状态', lib.getGameById('tjoc-reborn')?.status, 'offline')
  check('批量下线后 · 更新时间被写入', Boolean(lib.getGameById('tjoc-reborn')?.updatedAt), true)

  // —— 重复执行应被计入「跳过」而不是「改动」 ——
  select(TARGETS)
  await lib.batchSetStatus(TARGETS, 'offline')
  check('重复批量下线 · 实际改动数', lib.lastOutcome.value?.changed, 0)
  check('重复批量下线 · 跳过数', lib.lastOutcome.value?.skipped, 2)

  // —— 批量上线（复原） ——
  select(TARGETS)
  await lib.batchSetStatus(TARGETS, 'published')
  check('批量上线 · 实际改动数', lib.lastOutcome.value?.changed, 2)
  check('批量上线后 · 已上线计数', lib.statusCounts.value.published, 6)
  check('批量上线后 · 已下线计数', lib.statusCounts.value.offline, 0)

  // —— 批量添加标签 ——
  const NEW_TAGS = ['测试标签A', '测试标签B']
  select(TARGETS)
  await lib.batchAddTags(TARGETS, NEW_TAGS)
  check('批量添加标签 · 动作名', lib.lastOutcome.value?.label, '批量添加标签')
  check(
    '批量添加标签后 · 标签内容',
    lib.getGameById('tjoc-reborn')?.tags.join(','),
    '测试标签A,测试标签B',
  )
  check('批量添加标签后 · availableTags', lib.availableTags.value.join(','), '测试标签A,测试标签B')
  check('批量添加标签后 · allTags 使用次数', lib.allTags.value[0]?.usage, 2)
  check(
    '批量添加标签后 · 两条记录都拿到标签',
    lib.getGameById('popgoes')?.tags.join(','),
    '测试标签A,测试标签B',
  )

  select(TARGETS)
  await lib.batchAddTags(TARGETS, NEW_TAGS)
  check('重复添加同一批标签 · 实际改动数', lib.lastOutcome.value?.changed, 0)
  check('重复添加同一批标签 · 跳过数', lib.lastOutcome.value?.skipped, 2)

  // —— 所选条目的共同标签 ——
  select(TARGETS)
  check('所选条目的共同标签', lib.selectedCommonTags.value.join(','), '测试标签A,测试标签B')

  // 只选一条时，「共同标签」就是它自己的标签
  lib.clearSelection()
  lib.toggleSelect('tjoc-reborn')
  check('单条选中时的共同标签', lib.selectedCommonTags.value.join(','), '测试标签A,测试标签B')

  // —— 批量移除标签 ——
  select(TARGETS)
  await lib.batchRemoveTags(TARGETS, ['测试标签A'])
  check('批量移除标签后 · 标签内容', lib.getGameById('tjoc-reborn')?.tags.join(','), '测试标签B')
  check('批量移除标签后 · availableTags', lib.availableTags.value.join(','), '测试标签B')

  select(TARGETS)
  await lib.batchRemoveTags(TARGETS, ['测试标签B'])
  check('移除全部标签后 · availableTags 清空', lib.availableTags.value.length, 0)

  select(TARGETS)
  await lib.batchRemoveTags(TARGETS, ['不存在的标签'])
  check('移除不存在的标签 · 实际改动数', lib.lastOutcome.value?.changed, 0)
  check('移除不存在的标签 · 跳过数', lib.lastOutcome.value?.skipped, 2)

  // —— 批量修改作者（改完再改回来，保持数据原状） ——
  select(TARGETS)
  await lib.batchSetAuthor(TARGETS, '临时作者')
  check('批量改作者后 · tjoc-reborn', lib.getGameById('tjoc-reborn')?.author, '临时作者')
  check('批量改作者后 · popgoes', lib.getGameById('popgoes')?.author, '临时作者')
  check('批量改作者后 · 可用作者仍去重', lib.availableAuthors.value.includes('临时作者'), true)

  lib.clearSelection()
  lib.toggleSelect('tjoc-reborn')
  await lib.batchSetAuthor(['tjoc-reborn'], 'Nikson')
  lib.clearSelection()
  lib.toggleSelect('popgoes')
  await lib.batchSetAuthor(['popgoes'], 'Kane Carter')
  check('作者已复原 · tjoc-reborn', lib.getGameById('tjoc-reborn')?.author, 'Nikson')
  check('作者已复原 · popgoes', lib.getGameById('popgoes')?.author, 'Kane Carter')
  check('作者已复原 · 可用作者数量', lib.availableAuthors.value.length, 5)

  // —— 批量归档：归档是叠加维度，不改发布状态 ——
  select(TARGETS)
  await lib.batchSetArchived(TARGETS, true)
  check('批量归档 · 动作名', lib.lastOutcome.value?.label, '批量归档')
  check('批量归档后 · archived 计数', lib.statusCounts.value.archived, 2)
  check('批量归档后 · 「全部」计数不含已归档', lib.statusCounts.value.all, 4)
  check('批量归档后 · 发布状态未被改动', lib.getGameById('tjoc-reborn')?.status, 'published')

  lib.setStatusFilter('all')
  await settle()
  check('默认列表不含已归档条目', lib.total.value, 4)
  lib.setStatusFilter('published')
  await settle()
  check('状态 = 已上线 也不含已归档条目', lib.total.value, 4)
  lib.setStatusFilter('archived')
  await settle()
  check('状态 = 已归档 列表', lib.total.value, 2)

  // —— 取消归档（复原） ——
  select(TARGETS)
  await lib.batchSetArchived(TARGETS, false)
  check('批量取消归档 · 动作名', lib.lastOutcome.value?.label, '批量取消归档')
  check('取消归档后 · archived 计数', lib.statusCounts.value.archived, 0)
  lib.setStatusFilter('all')
  await settle()
  check('取消归档后 · 默认列表恢复', lib.total.value, 6)

  /* --------------------------- 13. 草稿态与单条保存（纯函数 + 写入） ---------- */
  const target: AdminGame | undefined = lib.getGameById('tjoc-reborn')
  if (!target) throw new Error('断言前置条件失败：目录中找不到 tjoc-reborn')

  // —— 纯函数：模型 → 草稿 ——
  check('gameToDraft · 标题', gameToDraft(target).title, 'The Joy of Creation: Reborn')
  check('gameToDraft · 年份转为字符串', gameToDraft(target).releaseYear, '2017')
  check(
    'gameToDraft · 缺失的 videoUrl 归一为空串',
    gameToDraft({ ...target, videoUrl: undefined }).videoUrl,
    '',
  )

  // —— 纯函数：校验 ——
  // 7 个字段里只有 videoUrl 可留空，所以空草稿应当恰好有 6 条错误
  check(
    '空草稿 · 错误条数（videoUrl 可留空）',
    Object.values(validateDraft(emptyDraft())).filter(Boolean).length,
    6,
  )
  check('空草稿 · 标题错误文案', validateDraft(emptyDraft()).title, '游戏名称不能为空')

  // —— 运行时类型漂移免疫（回归守卫）——
  // v-model 绑在 <input type="number"> 上时 Vue 会把值转成 Number，绕过 TS 的类型约束。
  // 纯函数对此必须免疫，否则表现是「校验静默失效 + 点保存毫无反应」，极难排查。
  // 这里的 `as unknown as string` 是**故意**的：模拟运行时的类型漂移。
  check(
    '校验 · releaseYear 实际是数字也不崩',
    validateDraft({ ...emptyDraft(), releaseYear: 1800 as unknown as string }).releaseYear,
    `发行年份不能早于 ${YEAR_RANGE.min}`,
  )
  check(
    '转换 · releaseYear 实际是数字也能转回 number',
    draftToPatch({ ...emptyDraft(), releaseYear: 2020 as unknown as string }).releaseYear,
    2020,
  )

  // —— 草稿态：加载 / 脏检查 / 撤销 ——
  const draftApi = useAdminGameDraft()
  draftApi.loadFrom(target)
  check('loadFrom · 草稿填充标题', draftApi.draft.title, 'The Joy of Creation: Reborn')
  check('loadFrom · 无未保存改动', draftApi.isDirty.value, false)
  check('loadFrom · 初始校验通过', draftApi.isValid.value, true)
  check('loadFrom · 初始未尝试提交', draftApi.touched.value, false)

  draftApi.draft.title = '被改过的标题'
  check('改动后 · isDirty', draftApi.isDirty.value, true)
  check('改动后 · changedFields', draftApi.changedFields.value.join(','), 'title')

  draftApi.resetToBaseline()
  check('撤销修改后 · isDirty', draftApi.isDirty.value, false)
  check('撤销修改后 · 标题回到基线', draftApi.draft.title, 'The Joy of Creation: Reborn')

  // 脏检查同样要抗类型漂移：数字 2017 与字符串 '2017' 必须视为「没改」
  draftApi.draft.releaseYear = 2017 as unknown as string
  check('脏检查 · 同值的数字与字符串不算改动', draftApi.isDirty.value, false)
  draftApi.resetToBaseline()

  draftApi.draft.releaseYear = 'abc'
  check('年份非数字 · 校验不通过', draftApi.isValid.value, false)
  check('年份非数字 · 错误文案', draftApi.errors.value.releaseYear, '发行年份必须是 4 位数字')

  draftApi.draft.releaseYear = '1800'
  check('年份过小 · 错误文案', draftApi.errors.value.releaseYear, `发行年份不能早于 ${YEAR_RANGE.min}`)

  draftApi.draft.releaseYear = String(YEAR_RANGE.max + 1)
  check('年份过大 · 错误文案', draftApi.errors.value.releaseYear, `发行年份不能晚于 ${YEAR_RANGE.max}`)

  draftApi.draft.releaseYear = '2017'
  check('年份恢复后 · 校验通过', draftApi.isValid.value, true)

  draftApi.draft.videoUrl = 'not-a-url'
  check(
    '视频地址非法 · 错误文案',
    draftApi.errors.value.videoUrl,
    '视频地址必须是 http:// 或 https:// 开头的完整链接',
  )
  draftApi.draft.videoUrl = 'https://example.com/v'
  check('视频地址合法 · 无错误', draftApi.errors.value.videoUrl, '')

  // —— markSaved 把基线同步为当前草稿 ——
  draftApi.draft.author = '临时改动'
  check('markSaved 前 · isDirty', draftApi.isDirty.value, true)
  draftApi.markSaved()
  check('markSaved 后 · isDirty', draftApi.isDirty.value, false)

  // —— 保存：更新路径 ——
  // 说明：前面的批量断言已经改过 tjoc-reborn，所以这里**不能**断言「updatedAt 从空变成非空」。
  // 时间戳写入的完整契约由下面「新建」路径断言（blankGame 里是空串，保存后被填上）。
  draftApi.loadFrom(lib.getGameById('tjoc-reborn'))
  draftApi.draft.title = 'TJOC Reborn（断言暂改）'
  const updateOutcome = await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(draftApi.draft) })
  check('更新保存 · mode', updateOutcome.mode, 'updated')
  check('更新保存 · id 不变', updateOutcome.game.id, 'tjoc-reborn')
  check('更新保存 · 标题已写入目录', lib.getGameById('tjoc-reborn')?.title, 'TJOC Reborn（断言暂改）')
  check(
    '更新保存 · updatedAt 是合法 ISO 时间戳',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(lib.getGameById('tjoc-reborn')?.updatedAt ?? ''),
    true,
  )
  check('更新保存 · 写入位置如实上报', updateOutcome.storage, 'memory')

  // 复原标题
  draftApi.loadFrom(lib.getGameById('tjoc-reborn'))
  draftApi.draft.title = 'The Joy of Creation: Reborn'
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(draftApi.draft) })
  check('更新保存 · 标题已复原', lib.getGameById('tjoc-reborn')?.title, 'The Joy of Creation: Reborn')

  // —— 保存：新建路径 ——
  const countBefore = lib.statusCounts.value.all
  const newDraft = emptyDraft()
  newDraft.title = 'Assertion Sample Game'
  newDraft.author = 'Test Author'
  newDraft.releaseYear = '2020'
  newDraft.ipSeries = 'FNAF 主线同人'
  newDraft.engine = 'Godot 4'
  newDraft.description = '仅用于断言的临时条目。'
  check('新草稿 · 已通过校验', validateDraft(newDraft).title, '')

  const newPatch = draftToPatch(newDraft)
  check('draftToPatch · 年份转回数字', newPatch.releaseYear, 2020)

  const createOutcome = await lib.saveGame({ patch: newPatch })
  check('新建 · mode', createOutcome.mode, 'created')
  check('新建 · 生成的 id', createOutcome.game.id, 'assertion-sample-game')
  check('新建 · 默认状态为草稿（不默认对外可见）', createOutcome.game.status, 'draft')
  check('新建 · createdAt 已写入', Boolean(createOutcome.game.createdAt), true)
  check('新建 · downloads 为空数组', createOutcome.game.downloads.length, 0)
  check('新建 · metrics 归零', createOutcome.game.metrics.score, 0)
  check('新建后 · 目录总数 +1', lib.statusCounts.value.all, countBefore + 1)
  check('新建后 · 归入草稿计数', lib.statusCounts.value.draft, 1)
  check('新建后 · 可用作者包含新作者', lib.availableAuthors.value.includes('Test Author'), true)

  // —— id 冲突时自动加后缀 ——
  const dupOutcome = await lib.saveGame({ patch: draftToPatch(newDraft) })
  check('同标题再建一条 · id 自动加后缀', dupOutcome.game.id, 'assertion-sample-game-2')

  // —— 保存不存在的 id 应显式抛错，而不是静默什么都不做 ——
  let thrown = ''
  try {
    await lib.saveGame({ id: 'not-exist', patch: { title: 'x' } })
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error)
  }
  check('保存不存在的 id · 抛出错误', thrown.includes('找不到'), true)

  /* ---------------------------------- 14. 标签（纯函数 + 草稿 + 目录级操作） ---------- */
  check('起始 · 目录中没有任何标签', lib.availableTags.value.length, 0)

  // —— 纯函数：归一化与合法性 ——
  check('normalizeTag · 去掉开头的 #', normalizeTag('#恐怖'), '恐怖')
  check('normalizeTag · 压缩内部空白', normalizeTag('  hi   there  '), 'hi there')
  check('normalizeTag · 全空白 → 空串', normalizeTag('   '), '')
  check('normalizeTag · 收到数字也不崩', normalizeTag(3 as unknown as string), '3')
  check('isValidTag · 空串非法', isValidTag(''), false)
  check('isValidTag · 超长非法', isValidTag('x'.repeat(TAG_LIMITS.maxLength + 1)), false)
  check('isValidTag · 正常合法', isValidTag('恐怖'), true)

  // —— 草稿态：标签增删 ——
  const tagApi = useAdminGameDraft()
  tagApi.loadFrom(lib.getGameById('tjoc-reborn'))
  check('标签草稿 · 起点为空', tagApi.draftTags.value.length, 0)
  check('标签草稿 · 起点无未保存改动', tagApi.isDirty.value, false)

  check('addTag · 返回加入数', tagApi.addTag('  #恐怖 '), 1)
  check('addTag · 已归一化', tagApi.draftTags.value.join(','), '恐怖')
  // ↓ 这条是**引用别名**的回归守卫：loadFrom 若用 Object.assign 复制，草稿与基线会共享
  //   同一个数组，改草稿等于改基线，isDirty 永远为 false，改动静默丢失。
  check('addTag · 触发 isDirty（基线未被连带修改）', tagApi.isDirty.value, true)

  check('addTag · 重复标签不加入', tagApi.addTag('恐怖'), 0)
  check('addTag · 空标签不加入', tagApi.addTag('   '), 0)
  check('addTag · 超长标签不加入', tagApi.addTag('x'.repeat(TAG_LIMITS.maxLength + 1)), 0)

  tagApi.addTag('3D')
  tagApi.addTag('剧情')
  check('草稿标签', tagApi.draftTags.value.join(','), '恐怖,3D,剧情')
  check('changedFields 含 tags', tagApi.changedFields.value.includes('tags'), true)

  tagApi.removeTag('3D')
  check('removeTag 后', tagApi.draftTags.value.join(','), '恐怖,剧情')

  for (let i = 0; i < TAG_LIMITS.maxPerGame + 5; i += 1) tagApi.addTag(`tag-${i}`)
  check('addTag · 受数量上限约束', tagApi.draftTags.value.length, TAG_LIMITS.maxPerGame)
  check('canAddTag · 满额后为 false', tagApi.canAddTag.value, false)

  tagApi.resetToBaseline()
  check('撤销修改后 · 标签回到基线', tagApi.draftTags.value.length, 0)
  check('撤销修改后 · isDirty', tagApi.isDirty.value, false)

  // —— 转换：标签去重 / 去空 / 限长 ——
  const messyDraft = emptyDraft()
  messyDraft.tags = ['恐怖', ' 恐怖 ', '#3D', '', 'x'.repeat(TAG_LIMITS.maxLength + 1)]
  check('draftToPatch · 标签去重去空限长', draftToPatch(messyDraft).tags?.join(','), '恐怖,3D')

  // —— 目录级：保存会写入标签 ——
  const saveTagsApi = useAdminGameDraft()
  saveTagsApi.loadFrom(lib.getGameById('tjoc-reborn'))
  saveTagsApi.addTag('恐怖')
  saveTagsApi.addTag('3D')
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(saveTagsApi.draft) })
  check('保存后 · 作品标签已写入', lib.getGameById('tjoc-reborn')?.tags.join(','), '恐怖,3D')
  // availableTags 是按「使用次数降序 → 名称升序」排的，不是录入顺序：
  // 两者使用次数都是 1，于是按名称排，中文排序里 '3D' 排在 '恐怖' 前面
  check('保存后 · availableTags（按名称升序）', lib.availableTags.value.join(','), '3D,恐怖')
  check('保存后 · findTag 使用次数', lib.findTag('恐怖')?.usage, 1)
  check('保存后 · 创建时间已记录（本次会话引入）', Boolean(lib.findTag('恐怖')?.createdAt), true)

  const shareTagApi = useAdminGameDraft()
  shareTagApi.loadFrom(lib.getGameById('popgoes'))
  shareTagApi.addTag('恐怖')
  await lib.saveGame({ id: 'popgoes', patch: draftToPatch(shareTagApi.draft) })
  check('第二款作品加上同一标签', lib.getGameById('popgoes')?.tags.join(','), '恐怖')
  check('findTag 使用次数累加', lib.findTag('恐怖')?.usage, 2)

  // —— 标签页搜索 ——
  lib.setTagSearch('3d')
  check('标签搜索 · 命中数（大小写不敏感）', lib.visibleTags.value.length, 1)
  check('标签搜索 · 命中名称', lib.visibleTags.value[0]?.name, '3D')
  lib.setTagSearch('zzz')
  check('标签搜索 · 无命中', lib.visibleTags.value.length, 0)
  lib.clearTagSearch()
  check('清空搜索后 · 恢复全部', lib.visibleTags.value.length, 2)

  // —— 重命名标签 ——
  await lib.renameTag('恐怖', '惊悚')
  check('重命名 · 动作名', lib.lastOutcome.value?.label, '重命名标签「恐怖」→「惊悚」')
  check('重命名 · 影响条数', lib.lastOutcome.value?.changed, 2)
  check('重命名后 · tjoc-reborn', lib.getGameById('tjoc-reborn')?.tags.join(','), '惊悚,3D')
  check('重命名后 · popgoes', lib.getGameById('popgoes')?.tags.join(','), '惊悚')
  check('重命名后 · 旧名已不存在', lib.availableTags.value.includes('恐怖'), false)
  check('重命名后 · 创建时间跟着标签走', Boolean(lib.findTag('惊悚')?.createdAt), true)

  // 目标名已存在于某条作品上 → 必须合并去重，不能产生重复标签
  await lib.renameTag('3D', '惊悚')
  check('重命名到已存在的名字 · 合并去重', lib.getGameById('tjoc-reborn')?.tags.join(','), '惊悚')

  await lib.renameTag('惊悚', '惊悚')
  check('改成同名 · 不改动任何作品', lib.lastOutcome.value?.changed, 0)

  // —— 删除标签 ——
  await lib.deleteTag('惊悚')
  check('删除标签 · 动作名', lib.lastOutcome.value?.label, '删除标签「惊悚」')
  check('删除标签 · 影响条数', lib.lastOutcome.value?.changed, 2)
  check('删除标签后 · tjoc-reborn 标签清空', lib.getGameById('tjoc-reborn')?.tags.length, 0)
  check('删除标签后 · 目录中不再有标签', lib.availableTags.value.length, 0)
  check('删除标签 · 作品本身还在', Boolean(lib.getGameById('tjoc-reborn')), true)

  /* ------------------------------------------- 15. 图片（纯函数 + 草稿 + 保存） ------ */
  check('空草稿 · 图库为空', emptyDraft().gallery.length, 0)
  check('gameToDraft · 图库是副本而不是引用', gameToDraft(target).gallery !== target.gallery, true)

  // —— 地址形式判定 ——
  check('isValidImageRef · 站内路径', isValidImageRef('/images/a.svg'), true)
  check('isValidImageRef · 带查询串', isValidImageRef('/images/a.png?v=2'), true)
  check('isValidImageRef · data URL', isValidImageRef('data:image/png;base64,AAA'), true)
  check('isValidImageRef · http 外链', isValidImageRef('https://cdn.x/a.webp'), true)
  check('isValidImageRef · 本地临时预览', isValidImageRef('blob:http://localhost:5173/x'), true)
  check('isValidImageRef · 纯文本 → 非法', isValidImageRef('hello'), false)
  check('isValidImageRef · 站内路径无扩展名 → 非法', isValidImageRef('/images/a'), false)
  check('isValidImageRef · 相对路径 → 非法', isValidImageRef('images/a.png'), false)
  check('isLocalPreviewUrl · blob: 命中', isLocalPreviewUrl('blob:http://x/y'), true)
  check('isLocalPreviewUrl · 普通地址不命中', isLocalPreviewUrl('/images/a.png'), false)

  // —— 校验：封面 / Banner 允许留空，填了必须是可用形式 ——
  const imgDraft = emptyDraft()
  check('封面 · 允许留空', validateDraft(imgDraft).coverImage, '')
  imgDraft.coverImage = '/images/a.png'
  check('封面 · 站内路径通过', validateDraft(imgDraft).coverImage, '')
  imgDraft.coverImage = 'https://cdn.example.com/a.webp'
  check('封面 · 外链通过', validateDraft(imgDraft).coverImage, '')
  imgDraft.coverImage = 'blob:http://localhost:5173/abc'
  check('封面 · 本地临时预览通过（UI 另行标注未上传）', validateDraft(imgDraft).coverImage, '')
  imgDraft.coverImage = 'images/a.png'
  check(
    '封面 · 相对路径报错',
    validateDraft(imgDraft).coverImage,
    '请填写站内路径（以 / 开头）或 http(s) 图片地址',
  )
  imgDraft.coverImage = ''
  imgDraft.bannerImage = '/images/' + 'x'.repeat(IMAGE_LIMITS.maxLength)
  check(
    'Banner · 超长报错',
    validateDraft(imgDraft).bannerImage,
    `图片地址不能超过 ${IMAGE_LIMITS.maxLength} 个字符`,
  )
  imgDraft.bannerImage = ''

  // —— 草稿态：图库增删改序 ——
  const galleryApi = useAdminGameDraft()
  galleryApi.loadFrom(lib.getGameById('tjoc-reborn'))
  check('图库草稿 · 起点 2 张', galleryApi.draftImages.value.length, 2)
  check('图库草稿 · 起点无改动', galleryApi.isDirty.value, false)

  check('addImages · 返回实际加入数', galleryApi.addImages(['/images/new-01.png']), 1)
  check('addImages · 重复不加入', galleryApi.addImages(['/images/new-01.png']), 0)
  check('addImages · 非法地址不加入', galleryApi.addImages(['not a path']), 0)
  check('addImages · 空串不加入', galleryApi.addImages(['   ']), 0)
  // 与标签同款的引用别名守卫：改草稿不能让基线跟着变
  check('addImages · 触发 isDirty（基线未被连带修改）', galleryApi.isDirty.value, true)
  check('changedFields 含 gallery', galleryApi.changedFields.value.includes('gallery'), true)

  check('moveImage · 首位上移越界返回 false', galleryApi.moveImage(0, -1), false)
  check(
    'moveImage · 末位下移越界返回 false',
    galleryApi.moveImage(galleryApi.draftImages.value.length - 1, 1),
    false,
  )

  const firstBefore = galleryApi.draftImages.value[0]
  const secondBefore = galleryApi.draftImages.value[1]
  check('moveImage · 下移成功', galleryApi.moveImage(0, 1), true)
  check(
    '下移后前两位交换',
    `${galleryApi.draftImages.value[0]}|${galleryApi.draftImages.value[1]}`,
    `${secondBefore}|${firstBefore}`,
  )
  check('moveImage · 上移还原', galleryApi.moveImage(1, -1), true)
  check('上移后顺序复原', galleryApi.draftImages.value[0], firstBefore)

  galleryApi.removeImage(0)
  check('removeImage 后数量', galleryApi.draftImages.value.length, 2)
  check('removeImage 后第一张变为原来的第二张', galleryApi.draftImages.value[0], secondBefore)

  for (let i = 0; i < IMAGE_LIMITS.maxGallery + 5; i += 1) {
    galleryApi.addImages([`/images/fill-${i}.png`])
  }
  check('图库受数量上限约束', galleryApi.draftImages.value.length, IMAGE_LIMITS.maxGallery)
  check('canAddImage · 满额后为 false', galleryApi.canAddImage.value, false)

  galleryApi.resetToBaseline()
  check('撤销修改后 · 图库回到基线', galleryApi.draftImages.value.length, 2)
  check('撤销修改后 · isDirty', galleryApi.isDirty.value, false)

  // —— 回归守卫：归一化**不做截断**，否则保存路径会静默丢数据 ——
  // （Phase 6 的 readTags 原本按上限截断，同时被 draftToPatch 使用 —— 已修）
  const overflowTags = {
    ...emptyDraft(),
    tags: Array.from({ length: TAG_LIMITS.maxPerGame + 3 }, (_, i) => `t${i}`),
  }
  check(
    'draftToPatch · 不截断超出上限的标签',
    draftToPatch(overflowTags).tags?.length,
    TAG_LIMITS.maxPerGame + 3,
  )
  const overflowImages = {
    ...emptyDraft(),
    gallery: Array.from({ length: IMAGE_LIMITS.maxGallery + 2 }, (_, i) => `/images/g-${i}.png`),
  }
  check(
    'draftToPatch · 不截断超出上限的图片',
    draftToPatch(overflowImages).gallery?.length,
    IMAGE_LIMITS.maxGallery + 2,
  )

  // —— 保存：封面 / Banner / 图库落到目录上 ——
  const mediaApi = useAdminGameDraft()
  // 先记下原有图库，用于断言「顺序保留」这条**规则**（而不是写死具体地址）
  const galleryBefore = lib.getGameById('tjoc-reborn')?.gallery ?? []

  mediaApi.loadFrom(lib.getGameById('tjoc-reborn'))
  mediaApi.setImage('coverImage', '/images/ui-test-cover.png')
  mediaApi.setImage('bannerImage', 'https://cdn.example.com/banner.webp')
  mediaApi.addImages(['/images/ui-test-gallery.png'])
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(mediaApi.draft) })
  check('保存后 · 封面已写入', lib.getGameById('tjoc-reborn')?.coverImage, '/images/ui-test-cover.png')
  check(
    '保存后 · Banner 已写入',
    lib.getGameById('tjoc-reborn')?.bannerImage,
    'https://cdn.example.com/banner.webp',
  )
  // ⚠️ 不写死具体地址：地址形态会随数据来源变化（站内路径 / 数据仓绝对外链）。
  //    要断言的是**顺序规则**：原有条目原样在前、新增的追加在后。
  const galleryAfter = lib.getGameById('tjoc-reborn')?.gallery ?? []
  check('保存后 · 图库条目数 = 原有 + 1', galleryAfter.length, galleryBefore.length + 1)
  check(
    '保存后 · 原有条目原样保留且顺序不变',
    galleryAfter.slice(0, galleryBefore.length).join(','),
    galleryBefore.join(','),
  )
  check(
    '保存后 · 新增的追加在最后',
    galleryAfter[galleryAfter.length - 1],
    '/images/ui-test-gallery.png',
  )

  mediaApi.clearImage('coverImage')
  check('clearImage · 清空封面', mediaApi.draft.coverImage, '')

  // 复原
  mediaApi.loadFrom(lib.getGameById('tjoc-reborn'))
  mediaApi.setImage('coverImage', '/images/tjoc-reborn-cover.svg')
  mediaApi.setImage('bannerImage', '/images/tjoc-reborn-banner.svg')
  mediaApi.removeImage(2)
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(mediaApi.draft) })
  check('复原后 · 封面', lib.getGameById('tjoc-reborn')?.coverImage, '/images/tjoc-reborn-cover.svg')
  check('复原后 · 图库回到 2 张', lib.getGameById('tjoc-reborn')?.gallery.length, 2)

  /* --------------------------------------- 16. 下载渠道（纯函数 + 草稿 + 保存） --- */
  check('空草稿 · 下载渠道为空', emptyDraft().downloads.length, 0)
  check(
    'gameToDraft · 下载行是副本而不是引用',
    gameToDraft(target).downloads[0] !== target.downloads[0],
    true,
  )
  check('gameToDraft · 行数与模型一致', gameToDraft(target).downloads.length, target.downloads.length)

  // —— 纯函数：逐行校验（每行只报第一条错误）——
  check(
    'validateDownload · 服务商为空',
    validateDownload({ provider: '', url: 'https://a.com', password: '' }),
    '服务商不能为空',
  )
  check(
    'validateDownload · 地址为空',
    validateDownload({ provider: '123云盘', url: '', password: '' }),
    '下载地址不能为空',
  )
  check(
    'validateDownload · 地址不是链接',
    validateDownload({ provider: '123云盘', url: 'www.a.com', password: '' }),
    '下载地址必须是 http:// 或 https:// 开头的完整链接',
  )
  check(
    'validateDownload · 全部通过',
    validateDownload({ provider: '123云盘', url: 'https://a.com/x', password: 'abcd' }),
    '',
  )
  check(
    'validateDownload · 提取码可留空',
    validateDownload({ provider: '123云盘', url: 'https://a.com/x', password: '' }),
    '',
  )
  check(
    'validateDownload · 服务商超长',
    validateDownload({
      provider: 'x'.repeat(DOWNLOAD_LIMITS.maxTextLength + 1),
      url: 'https://a.com',
      password: '',
    }),
    `服务商不能超过 ${DOWNLOAD_LIMITS.maxTextLength} 个字符`,
  )
  check(
    'validateDownload · 提取码超长',
    validateDownload({
      provider: '123云盘',
      url: 'https://a.com',
      password: 'x'.repeat(DOWNLOAD_LIMITS.maxTextLength + 1),
    }),
    `提取码不能超过 ${DOWNLOAD_LIMITS.maxTextLength} 个字符`,
  )

  // —— 草稿态：行增删改序 ——
  const dlApi = useAdminGameDraft()
  dlApi.loadFrom(lib.getGameById('tjoc-reborn'))
  check('下载草稿 · 起点行数', dlApi.draftDownloads.value.length, 2)
  check('下载草稿 · 起点无改动', dlApi.isDirty.value, false)
  check('下载草稿 · 起点整份草稿校验通过', dlApi.isValid.value, true)

  dlApi.addDownload()
  check('addDownload 后行数', dlApi.draftDownloads.value.length, 3)
  check('新加的行是空白的', dlApi.draftDownloads.value[2].provider, '')
  check('空行让整份草稿校验不通过', dlApi.isValid.value, false)
  check('逐行错误与行一一对应', dlApi.downloadErrors.value.length, 3)
  check('空行的错误文案', dlApi.downloadErrors.value[2], '服务商不能为空')
  check('addDownload 触发 isDirty', dlApi.isDirty.value, true)

  const rowFirst = dlApi.draftDownloads.value[0].provider
  const rowSecond = dlApi.draftDownloads.value[1].provider
  check('moveDownload · 首位上移越界返回 false', dlApi.moveDownload(0, -1), false)
  check('moveDownload · 下移成功', dlApi.moveDownload(0, 1), true)
  check(
    '下移后前两行交换',
    `${dlApi.draftDownloads.value[0].provider}|${dlApi.draftDownloads.value[1].provider}`,
    `${rowSecond}|${rowFirst}`,
  )
  check('moveDownload · 上移还原', dlApi.moveDownload(1, -1), true)
  check('上移后顺序复原', dlApi.draftDownloads.value[0].provider, rowFirst)

  dlApi.removeDownload(2)
  check('removeDownload 后行数', dlApi.draftDownloads.value.length, 2)
  check('删掉空行后校验恢复', dlApi.isValid.value, true)

  for (let i = 0; i < DOWNLOAD_LIMITS.maxPerGame + 3; i += 1) dlApi.addDownload()
  check('下载渠道受数量上限约束', dlApi.draftDownloads.value.length, DOWNLOAD_LIMITS.maxPerGame)
  check('canAddDownload · 满额后为 false', dlApi.canAddDownload.value, false)

  dlApi.resetToBaseline()
  check('撤销修改后 · 下载渠道回到基线', dlApi.draftDownloads.value.length, 2)
  check('撤销修改后 · isDirty', dlApi.isDirty.value, false)

  // —— 引用别名守卫：行对象也必须深拷贝 ——
  const dlAliasApi = useAdminGameDraft()
  dlAliasApi.loadFrom(lib.getGameById('tjoc-reborn'))
  dlAliasApi.draft.downloads[0].provider = '改过的服务商'
  check('改草稿行不影响基线（行对象是副本）', dlAliasApi.isDirty.value, true)
  dlAliasApi.resetToBaseline()
  check(
    '撤销后行内容回到基线',
    dlAliasApi.draftDownloads.value[0].provider,
    lib.getGameById('tjoc-reborn')?.downloads[0]?.provider,
  )

  // —— 转换：提取码空串 → undefined（与模型的 optional 对齐）——
  const baseDraft = gameToDraft(target)
  check(
    'draftToPatch · 提取码留空写成 undefined',
    draftToPatch({ ...baseDraft, downloads: [{ provider: 'a', url: 'https://a.com', password: '' }] })
      .downloads?.[0]?.password,
    'undefined',
  )
  check(
    'draftToPatch · 提取码被 trim 后保留',
    draftToPatch({
      ...baseDraft,
      downloads: [{ provider: ' a ', url: ' https://a.com ', password: ' ab ' }],
    }).downloads?.[0]?.password,
    'ab',
  )
  const overflowDownloads = {
    ...emptyDraft(),
    downloads: Array.from({ length: DOWNLOAD_LIMITS.maxPerGame + 2 }, (_, i) => ({
      provider: `p${i}`,
      url: 'https://a.com',
      password: '',
    })),
  }
  check(
    'draftToPatch · 不截断超出上限的下载渠道',
    draftToPatch(overflowDownloads).downloads?.length,
    DOWNLOAD_LIMITS.maxPerGame + 2,
  )

  // —— 保存落到目录上 ——
  const dlSaveApi = useAdminGameDraft()
  dlSaveApi.loadFrom(lib.getGameById('tjoc-reborn'))
  dlSaveApi.addDownload()
  dlSaveApi.draft.downloads[2] = {
    provider: '夸克网盘',
    url: 'https://pan.quark.cn/s/ui-test',
    password: 'ui9',
  }
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(dlSaveApi.draft) })
  check('保存后 · 渠道数', lib.getGameById('tjoc-reborn')?.downloads.length, 3)
  check('保存后 · 新渠道服务商', lib.getGameById('tjoc-reborn')?.downloads[2]?.provider, '夸克网盘')
  check('保存后 · 新渠道提取码', lib.getGameById('tjoc-reborn')?.downloads[2]?.password, 'ui9')

  dlSaveApi.loadFrom(lib.getGameById('tjoc-reborn'))
  dlSaveApi.removeDownload(2)
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(dlSaveApi.draft) })
  check('复原后 · 渠道数', lib.getGameById('tjoc-reborn')?.downloads.length, 2)
  check('复原后 · 原有提取码保留', lib.getGameById('tjoc-reborn')?.downloads[0]?.password, 'tjoc')

  /* -------------------------------- 17. 发布状态 / 归档 / 推荐与排序 --------------- */
  const pubApi = useAdminGameDraft()
  pubApi.loadFrom(lib.getGameById('tjoc-reborn'))
  check('发布草稿 · 状态来自模型', pubApi.draft.status, 'published')
  check('发布草稿 · 起点无改动', pubApi.isDirty.value, false)
  check('发布草稿 · 起点无发布缺口', pubApi.publishIssues.value.length, 0)
  check('发布草稿 · 起点可保存', pubApi.canSave.value, true)

  pubApi.draft.status = 'draft'
  check('改状态触发 isDirty', pubApi.isDirty.value, true)
  check('changedFields 含 status', pubApi.changedFields.value.includes('status'), true)
  check('草稿状态可保存', pubApi.canSave.value, true)

  pubApi.draft.archived = true
  check('changedFields 含 archived', pubApi.changedFields.value.includes('archived'), true)
  pubApi.draft.featured = true
  check('changedFields 含 featured', pubApi.changedFields.value.includes('featured'), true)
  pubApi.draft.sortOrder = '5'
  check('changedFields 含 sortOrder', pubApi.changedFields.value.includes('sortOrder'), true)

  // —— 排序权重校验 ——
  pubApi.draft.sortOrder = ''
  check('排序权重留空 · 通过（视为 0）', pubApi.errors.value.sortOrder, '')
  pubApi.draft.sortOrder = '-3'
  check('排序权重负数 · 通过', pubApi.errors.value.sortOrder, '')
  pubApi.draft.sortOrder = '1.5'
  check(
    '排序权重小数 · 报错',
    pubApi.errors.value.sortOrder,
    '排序权重必须是整数（可以是负数），留空表示 0',
  )
  pubApi.draft.sortOrder = 'abc'
  check('排序权重非数字 · 报错', pubApi.errors.value.sortOrder !== '', true)
  pubApi.draft.sortOrder = '5'

  // —— 发布缺口：草稿不受限，已上线必须有内容 ——
  const gapApi = useAdminGameDraft()
  gapApi.loadFrom(lib.getGameById('tjoc-reborn'))
  gapApi.draft.coverImage = ''
  gapApi.draft.status = 'published'
  check('缺封面 · 发布缺口条数', gapApi.publishIssues.value.length, 1)
  check('缺封面 · 缺口文案', gapApi.publishIssues.value[0], '还没有封面图')
  check('缺封面 · 基础校验仍通过（封面非必填）', gapApi.isValid.value, true)
  check('缺封面 · 已上线不可保存', gapApi.canSave.value, false)

  gapApi.draft.status = 'draft'
  check('切回草稿 · 又可保存', gapApi.canSave.value, true)

  gapApi.draft.bannerImage = ''
  gapApi.draft.downloads = []
  gapApi.draft.status = 'published'
  check('缺封面 + Banner + 下载 · 缺口条数', gapApi.publishIssues.value.length, 3)
  check(
    '缺口顺序（封面 → Banner → 下载）',
    gapApi.publishIssues.value.join('|'),
    '还没有封面图|还没有 Banner 宣传图|还没有下载渠道',
  )

  // —— 防御性归一：状态脏值一律降级为 draft（宁可少发布，不可误发布）——
  const bogusStatus = { ...emptyDraft(), status: 'weird' as unknown as 'draft' }
  check('readStatus · 非法值降级为 draft', draftToPatch(bogusStatus).status, 'draft')

  // —— 保存落到目录上 ——
  const pubSaveApi = useAdminGameDraft()
  pubSaveApi.loadFrom(lib.getGameById('tjoc-reborn'))
  pubSaveApi.draft.status = 'offline'
  pubSaveApi.draft.featured = true
  pubSaveApi.draft.sortOrder = '7'
  pubSaveApi.draft.archived = true
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(pubSaveApi.draft) })
  check('保存后 · status', lib.getGameById('tjoc-reborn')?.status, 'offline')
  check('保存后 · featured', lib.getGameById('tjoc-reborn')?.featured, true)
  check('保存后 · sortOrder', lib.getGameById('tjoc-reborn')?.sortOrder, 7)
  check('保存后 · archived', lib.getGameById('tjoc-reborn')?.archived, true)

  // 复原
  pubSaveApi.loadFrom(lib.getGameById('tjoc-reborn'))
  pubSaveApi.draft.status = 'published'
  pubSaveApi.draft.featured = false
  pubSaveApi.draft.sortOrder = ''
  pubSaveApi.draft.archived = false
  await lib.saveGame({ id: 'tjoc-reborn', patch: draftToPatch(pubSaveApi.draft) })
  check('复原后 · status', lib.getGameById('tjoc-reborn')?.status, 'published')
  check('复原后 · featured', lib.getGameById('tjoc-reborn')?.featured, false)
  check('复原后 · sortOrder 归零', lib.getGameById('tjoc-reborn')?.sortOrder, 0)
  check('复原后 · archived', lib.getGameById('tjoc-reborn')?.archived, false)

  /* ---------------------------------------- 18. Repository 契约（Phase 11） ------- */
  const repoStartCount = (await publicGameRepository.listGames()).length

  // listGames 返回副本 —— 否则任何调用方都能顺手把内部数据改坏
  const listed = await publicGameRepository.listGames()
  listed[0].title = '被改坏了'
  check(
    '仓储 · listGames 返回副本（改不动内部数据）',
    (await publicGameRepository.getGame(listed[0].id))?.title === '被改坏了',
    false,
  )

  check('仓储 · getGame 取不到时返回 undefined', await publicGameRepository.getGame('nope'), undefined)

  // —— 新建 ——
  const repoCreated = await publicGameRepository.createGame({
    title: 'Repository Contract Test',
    status: 'draft',
  })
  check('仓储 · createGame 由标题生成 slug id', repoCreated.id, 'repository-contract-test')
  check('仓储 · createGame 缺省状态是 draft', repoCreated.status, 'draft')
  check('仓储 · createGame 打上 createdAt', repoCreated.createdAt !== '', true)
  check(
    '仓储 · 新建的条目排在列表首位',
    (await publicGameRepository.listGames())[0].id,
    'repository-contract-test',
  )
  check(
    '仓储 · 响应式快照能看到写入',
    publicGameRepository.games.value.some((game) => game.id === repoCreated.id),
    true,
  )

  const repoTwin = await publicGameRepository.createGame({ title: 'Repository Contract Test' })
  check('仓储 · 同名标题的 id 自动加后缀', repoTwin.id, 'repository-contract-test-2')
  await publicGameRepository.deleteGame(repoTwin.id)

  // —— 更新 ——
  await publicGameRepository.updateGame(repoCreated.id, { title: '改过的标题' })
  check('仓储 · updateGame 生效', (await publicGameRepository.getGame(repoCreated.id))?.title, '改过的标题')

  const beforeUpdate = (await publicGameRepository.getGame(repoCreated.id))?.updatedAt ?? ''
  // 隔开 1ms 以上，否则「时间戳被刷新」会因为同一毫秒而假失败
  await new Promise((done) => setTimeout(done, 5))
  await publicGameRepository.updateGame(repoCreated.id, { author: 'Repo Test' })
  check(
    '仓储 · updateGame 会刷新 updatedAt',
    ((await publicGameRepository.getGame(repoCreated.id))?.updatedAt ?? '') !== beforeUpdate,
    true,
  )

  let updateError = ''
  try {
    await publicGameRepository.updateGame('does-not-exist', { title: 'x' })
  } catch (error) {
    updateError = error instanceof Error ? error.message : String(error)
  }
  check('仓储 · updateGame 对不存在的 id 显式抛错', updateError.includes('找不到 id'), true)

  // —— 上线 / 下线 ——
  await publicGameRepository.publishGame(repoCreated.id)
  check(
    '仓储 · publishGame 置为 published',
    (await publicGameRepository.getGame(repoCreated.id))?.status,
    'published',
  )
  await publicGameRepository.unpublishGame(repoCreated.id)
  check(
    '仓储 · unpublishGame 置为 offline',
    (await publicGameRepository.getGame(repoCreated.id))?.status,
    'offline',
  )
  check(
    '仓储 · 下线只是改状态，数据仍在',
    Boolean(await publicGameRepository.getGame(repoCreated.id)),
    true,
  )

  // —— 删除 ——
  check('仓储 · deleteGame 删除存在的条目返回 true', await publicGameRepository.deleteGame(repoCreated.id), true)
  check(
    '仓储 · deleteGame 对已删除的 id 返回 false',
    await publicGameRepository.deleteGame(repoCreated.id),
    false,
  )
  check('仓储 · 收尾后条目数复原', (await publicGameRepository.listGames()).length, repoStartCount)

  /* --------------------------------- 19. 本地持久化（Phase 12，注入假存储） -------- */
  // Node 里没有 localStorage，所以这里注入一个假的来验证**持久化契约本身**：
  // 写入 → 新实例（= 刷新页面）读得到、存档损坏退回出厂、写失败不假装成功。
  // 真实 localStorage 的端到端验证在 UI 点击测试里（真的刷新页面再断言）。
  function fakeStorage(): { backend: StorageLike; map: Map<string, string> } {
    const map = new Map<string, string>()
    return {
      map,
      backend: {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => {
          map.set(key, value)
        },
      },
    }
  }

  const disk = fakeStorage()
  const repoA = createLocalGameRepository({ storage: disk.backend })
  check('持久化 · 有可用存储时 storage 为 local', repoA.storage.value, 'local')

  await repoA.updateGame('tjoc-reborn', { status: 'offline' })
  check('持久化 · 写入后存档里确实有内容', disk.map.has(STORAGE_KEY), true)

  // 新实例 = 模拟刷新页面
  const repoB = createLocalGameRepository({ storage: disk.backend })
  check(
    '持久化 · 新实例读得到上次的改动（刷新不丢）',
    (await repoB.getGame('tjoc-reborn'))?.status,
    'offline',
  )
  check(
    '持久化 · 新实例的条目数一致',
    (await repoB.listGames()).length,
    (await repoA.listGames()).length,
  )

  // 存档损坏 → 退回出厂数据，绝不让站点变空
  disk.map.set(STORAGE_KEY, '{ 这不是 JSON')
  check(
    '持久化 · 存档解析失败时退回出厂数据',
    (await createLocalGameRepository({ storage: disk.backend }).getGame('tjoc-reborn'))?.status,
    'published',
  )
  disk.map.set(STORAGE_KEY, JSON.stringify({ not: 'an array' }))
  check(
    '持久化 · 存档不是数组时也退回出厂数据',
    (await createLocalGameRepository({ storage: disk.backend }).getGame('tjoc-reborn'))?.status,
    'published',
  )

  // 没有可用存储（SSR / 隐私模式）→ 只写内存
  check(
    '持久化 · 没有存储时 storage 为 memory',
    createLocalGameRepository({ storage: null }).storage.value,
    'memory',
  )

  // 写入失败（配额满）→ 降级为 memory，**不假装成功**
  const failing = createLocalGameRepository({
    storage: {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    },
  })
  check('持久化 · 写失败之前仍报 local', failing.storage.value, 'local')
  await failing.updateGame('tjoc-reborn', { status: 'draft' })
  check('持久化 · 写失败之后降级为 memory（不假装成功）', failing.storage.value, 'memory')

  // 恢复出厂数据
  const disk2 = fakeStorage()
  const repoE = createLocalGameRepository({ storage: disk2.backend })
  await repoE.updateGame('tjoc-reborn', { status: 'offline' })
  await repoE.resetToSeed()
  check('重置 · 内存里回到出厂数据', (await repoE.getGame('tjoc-reborn'))?.status, 'published')
  check(
    '重置 · 重置也落了盘（新实例读到的就是出厂数据）',
    (await createLocalGameRepository({ storage: disk2.backend }).getGame('tjoc-reborn'))?.status,
    'published',
  )

  /* ------------------- 20. 远程仓储：read-modify-write 与冲突重试 ------------------- */
  // 这一段用一个假的 fetch 模拟 GitHub，专门验证**这个阶段最容易出错的部分**：
  //   db.json 是单个文件 → 两人同时保存必冲突 → 必须「重读最新 → 重放改动 → 带 sha 重提交」。
  // 重放的正确性（不能把别人刚改的东西覆盖掉）是这里最该被钉死的性质。
  const remote = await createRemoteStub()
  const remoteRepo = createGitHubGameRepository({
    token: 'test-token',
    ref: { owner: 'o', repo: 'r', branch: 'main', path: 'db.json' },
    account: () => 'test-admin',
  })
  await new Promise((done) => setTimeout(done, 10))

  check('远程仓 · load 后 ready 为 true', remoteRepo.ready.value, true)
  check('远程仓 · load 无错误', remoteRepo.error.value, '')
  // 数量与「刚读到的本地快照」同源比较，而不是写死 —— 前面的断言已经增删过条目
  check(
    '远程仓 · 读到的条数与数据源一致',
    (await remoteRepo.listGames()).length,
    (await publicGameRepository.listGames()).length,
  )
  check('远程仓 · storage 如实报为 remote', remoteRepo.storage.value, 'remote')

  // 一次普通更新：应该产生一次提交，并带上读到的 sha
  await remoteRepo.updateGame('popgoes', { status: 'offline' })
  check('远程仓 · 更新后本地快照同步', (await remoteRepo.getGame('popgoes'))?.status, 'offline')
  check('远程仓 · 产生了一次提交', remote.putCount, 1)
  check('远程仓 · 提交带了 sha 做乐观锁', remote.lastPutSha !== '', true)
  check('远程仓 · 提交信息可读', remote.lastPutMessage.includes('更新'), true)

  // Phase 19：写入要署名 —— 多人后台里「谁最后碰过这条数据」跟时间同等重要
  check('远程仓 · 更新后带上了操作者署名', (await remoteRepo.getGame('popgoes'))?.updatedBy, 'test-admin')

  // ⚠️ 关键性质：撞上 409 时，必须重读最新内容再**重放**自己的改动，
  //    而不是用自己的旧快照覆盖 —— 否则会静默丢掉别人刚保存的东西。
  remote.conflictOnce = true

  await remoteRepo.updateGame('dayshift-at-freddys', { status: 'offline' })
  check('远程仓 · 撞 409 后自动重试并最终成功', remote.conflictCount, 1)
  check(
    '远程仓 · 重放后**自己的**改动生效',
    (await remoteRepo.getGame('dayshift-at-freddys'))?.status,
    'offline',
  )
  check(
    '远程仓 · 重放没有覆盖掉**别人**的改动',
    (await remoteRepo.getGame('tjoc-reborn'))?.author,
    '被别的管理员改过',
  )

  // 不存在的 id 要抛错，而不是静默新建
  let remoteError = ''
  try {
    await remoteRepo.updateGame('does-not-exist', { title: 'x' })
  } catch (error) {
    remoteError = error instanceof Error ? error.message : String(error)
  }
  check('远程仓 · 更新不存在的 id 显式抛错', remoteError.includes('找不到 id'), true)

  // 远程仓不该提供「一键恢复出厂」——那等于用出厂内容覆盖线上数据仓
  let resetError = ''
  try {
    await remoteRepo.resetToSeed()
  } catch (error) {
    resetError = error instanceof Error ? error.message : String(error)
  }
  check('远程仓 · resetToSeed 拒绝执行', resetError.includes('不支持'), true)

  remote.restore()

  /* ------------------------- 21. 图片上传（Phase 16） ------------------------- */
  const remoteUpload = await createRemoteStub()
  const uploader = createGitHubGameRepository({
    token: 'test-token',
    ref: { owner: 'o', repo: 'r', branch: 'main', path: 'db.json' },
    account: () => 'test-admin',
  })
  await new Promise((done) => setTimeout(done, 10))

  const imageFile = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  const uploadedUrl = await uploader.uploadImage(imageFile, {
    gameId: 'TJOC Reborn!',
    slot: 'cover',
  })

  check(
    '上传 · 返回数据仓 Pages 的绝对地址',
    uploadedUrl.startsWith('https://o.github.io/r/images/games/'),
    true,
  )
  check('上传 · 按作品 slug 分目录', uploadedUrl.includes('/images/games/tjoc-reborn/'), true)
  check('上传 · 文件名含位置与扩展名', /cover-\d{14}\.jpg$/.test(uploadedUrl), true)
  check(
    '上传 · 确实提交到了远端',
    remoteUpload.lastPutMessage.includes('上传图片'),
    true,
  )
  check('上传 · 不覆盖已有文件（每次都是新地址，绕开缓存）', remoteUpload.lastPutSha, '')

  // 本地模式**必须明确拒绝**，而不是返回一个假地址 ——
  // 后者会让用户以为图片已经上传成功了
  let uploadError = ''
  try {
    await publicGameRepository.uploadImage(imageFile, { gameId: 'x', slot: 'cover' })
  } catch (error) {
    uploadError = error instanceof Error ? error.message : String(error)
  }
  check('上传 · 本地模式明确拒绝而不是给假地址', uploadError.includes('没有可写的远端'), true)

  remoteUpload.restore()

  /* ------------------- 22. 图片处理（Phase 17：尺寸 / 重试 / 删旧图） ------------------- */
  // 尺寸校验是纯函数，直接测它 —— 不必在 Node 里伪造位图
  check('尺寸 · 太小被拒（封面 320×180）', checkImageSize({ width: 320, height: 180 }, 'cover') !== null, true)
  check('尺寸 · 刚好合格（封面 640×360）', checkImageSize({ width: 640, height: 360 }, 'cover'), null)
  check('尺寸 · 图库标准更低（400×225 合格）', checkImageSize({ width: 400, height: 225 }, 'gallery'), null)
  check('尺寸 · 图库 399 宽被拒', checkImageSize({ width: 399, height: 225 }, 'gallery') !== null, true)
  check(
    '尺寸 · 单边过大被拒',
    checkImageSize({ width: 9000, height: 5000 }, 'cover') !== null,
    true,
  )

  // 比例只提示、不拦 —— 这正是「拿确定性成本换一点观感」的那条取舍
  check('比例 · 16:9 不提示', aspectWarning({ width: 640, height: 360 }, 'cover'), '')
  check('比例 · 1:1 会提示', aspectWarning({ width: 600, height: 600 }, 'cover').includes('留白'), true)
  check(
    '比例 · 偏离很小（17:9）不提示',
    aspectWarning({ width: 680, height: 360 }, 'cover'),
    '',
  )

  // 删旧图的两道闸：只删数据仓上传目录里的图
  const remoteDelete = await createRemoteStub()
  const deletable = createGitHubGameRepository({
    token: 'test-token',
    ref: { owner: 'o', repo: 'r', branch: 'main', path: 'db.json' },
  })
  await new Promise((done) => setTimeout(done, 10))

  let deleteRefused = ''
  try {
    await deletable.deleteImage('https://o.github.io/r/images/tjoc-reborn-cover.svg')
  } catch (error) {
    deleteRefused = error instanceof Error ? error.message : String(error)
  }
  check('删旧图 · 站内旧资源一律不碰', deleteRefused.includes('不属于数据仓的上传目录'), true)

  let deleteForeign = ''
  try {
    await deletable.deleteImage('https://cdn.example.com/someone-elses.png')
  } catch (error) {
    deleteForeign = error instanceof Error ? error.message : String(error)
  }
  check('删旧图 · 外部图床也不碰', deleteForeign.includes('不属于数据仓的上传目录'), true)

  // 幂等：文件已经不在了，重复清理不该报错
  let deleteMissing = ''
  try {
    await deletable.deleteImage('https://o.github.io/r/images/games/x/cover-1.png')
  } catch (error) {
    deleteMissing = error instanceof Error ? error.message : String(error)
  }
  check('删旧图 · 图已不在时静默通过（幂等）', deleteMissing, '')
  remoteDelete.restore()

  // ⚠️ 最要紧的一条：清理失败**绝不能**让保存失败。
  //    selftest 里生效的是本地仓储，它的 deleteImage 会抛错 ——
  //    正好用来验证这条：保存该成功、cleanedImages 记 0。
  const saveWithCleanup = await lib.saveGame({
    id: 'tjoc-reborn',
    patch: { coverImage: '/images/another-cover.png' },
  })
  check('删旧图 · 清理失败不影响保存成功', saveWithCleanup.mode, 'updated')
  check('删旧图 · 清理失败时如实记 0', saveWithCleanup.cleanedImages, 0)

  /* ------------------------------------------------------ 复原默认状态 */
  lib.clearTagSearch()
  lib.setPageSize(20)
  lib.setSortBy('updatedAt')
  lib.clearSelection()
  lib.clearQuery()
  await settle()

  return results
}
