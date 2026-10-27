# Phase 3 实施报告：前台可点击属性索引与 URL 状态

> 日期：2026-10-27
> 状态：**Phase 3 已完成，等待确认后进入 Phase 4**
> 设计依据：`structured_data_phase0_design_freeze.md`、`structured_data_phase2_report.md`

## 1. 交付摘要

Phase 3 把详情页的关键属性变成索引入口，并让首页筛选状态可刷新、可分享、可前进后退：

- 查询引擎升级为**八维、多值**：作者 / 年份 / 系列 / 玩法 / 机制 / 标签 / 平台 / 引擎；
  同维度 OR，跨维度 AND，搜索与所有条件叠加。
- 详情页的作者、年份、IP 系列、引擎、玩法、机制、平台、标签均可点击，
  进入首页对应索引结果；点击时清空其他条件、回到第 1 页与默认排序。
- 新增 `src/utils/filterUrl.ts`：URL query ↔ 查询状态的纯函数；
  默认值不写进 URL，未知参数忽略，坏值回退。
- 首页 URL 同步：页面内改动用 `replace`，详情进索引用 `push`；
  刷新、复制链接、后退 / 前进都保留状态。
- 失效条件（词条被删除、值不在可见目录里）保留并标红，提供单个移除与「清除失效条件」。
- 搜索覆盖标题、其他名称、作者、系列、引擎、标签、玩法 / 机制 / 平台名称。

**没有新增路由，没有改数据仓，没有批量标注作品。**

## 2. 查询引擎

`useGameLibrary` 的 `QueryState` 从「单值 + 三组」改为数组：

| 维度 | 匹配方式 |
| --- | --- |
| `author` / `series` / `engine` | 精确匹配，同维多值 OR |
| `year` | `String(releaseYear)` 精确匹配，多值 OR |
| `tag` | 作品标签数组包含任一所选值 |
| `gameplay` / `mechanic` / `platform` | 两边都解析成词条稳定 id 后比较；历史名称写法也能匹配 |

- 搜索索引一次性构建：`title + altTitles + author + ipSeries + engine + tags + 词条展示名`。
- 过滤选项（`available*`）全部从 `VISIBLE` 派生：
  `availableGameplayTypes / availableMechanics / availablePlatforms` 只包含**至少被一款可见作品使用**的词条；
  `availableTags / availableEngines` 同理。
- `searchGames()`（催资源对话框的站内预检）复用同一份搜索文本。
- 所有结果仍以 `isPubliclyVisible()` 为准，草稿 / 下线 / 归档不会经索引泄漏。

## 3. URL 契约

| 参数 | 含义 | 规则 |
| --- | --- | --- |
| `q` | 搜索词 | 空则不写 |
| `sort` | 排序键 | 等于默认 `views` 时不写 |
| `page` | 页码 | 第 1 页不写；载入时夹紧到 `[1, totalPages]` |
| `author` / `year` / `series` / `gameplay` / `mechanic` / `tag` / `platform` / `engine` | 多值筛选 | 重复参数表示多值；空数组不写 |

- 同维多值 = OR，跨维 = AND。
- 未知参数忽略；非法 `sort` 回退默认，非法 `page` 回退 1，重复值去重保序。
- 筛选 / 搜索 / 排序变化 → 页码回到 1。
- 首页内更新用 `router.replace`（不刷历史）；详情页的索引入口用 `router.push`（后退可回详情）。
- `scrollBehavior` 在「仅 query 变化」时返回 `false`，避免每敲一个字都被拉回页首；
  从详情页进入带条件的首页时，挂载后滚到 `#library`。

## 4. 失效条件与空状态

- 词条维度：词表里**完全没有**该 id → 失效；词条存在但没有可见作品 → 合法但空结果。
- 文本维度：值不在当前可见目录的 `available*` 里 → 失效。
- 失效条件不静默丢弃：仍在 `activeFilterChips` 里，标红「已失效」，
  可单独移除，也可「清除失效条件」。
- 无结果沿用现有空状态，并提供「清除全部筛选」。

## 5. 修改文件

**新增**

- `src/utils/filterUrl.ts`
- `src/dev/filterUrlAssertions.ts`
- `structured_data_phase3_report.md`（本文件）

**修改**

- 查询 / 状态：`src/composables/useGameLibrary.ts`、`src/dev/libraryAssertions.ts`
- 前台：`src/views/Home.vue`、`src/views/GameDetail.vue`、`src/components/FilterPanel.vue`
  （仅搜索占位文案）
- 路由：`src/router/index.ts`（query-only 导航不滚回顶部）
- 测试：`scripts/selftest.mts`、`scripts/smoke.ts`、`scripts/ui-test.mjs`
- 文档：`README.md`、`HANDOVER.md`

## 6. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:gamejolt` | 22/22 |
| `npm run test:catalog` | 3/3 |
| `npm run build:extension` | 通过 |
| `npm run selftest` | **819/819**（Phase 3 新增 19 条 library + 26 条 filterUrl） |
| `npm run smoke` | **16/16**（新增带 query 的首页首帧断言） |
| `npm run build` | 通过 |
| `npm run verify` | 全部通过 |
| `npm run test:ui` | **93/93**（新增 6 步前台索引用例） |

UI 用例覆盖：

1. 详情页点击「传统守夜式」→ URL 带上 `gameplay=`、命中 1 款、草稿不出现。
2. 平台 / 机制 / 作者 / 年份 / 标签分别点击，均进入对应索引结果。
3. 刷新保留条件；后退回详情页；前进恢复索引结果。
4. `?year=2019&year=2021` 两条 → 2 款；跨维 AND → 正确交集；搜索其他名称 `altTitles`。
5. 失效词条 → 标红 + 「清除失效条件」→ 恢复完整集合。
6. 清除全部筛选 → URL 清空、恢复完整公开集合。

## 7. 已知限制

1. **筛选面板仍是作者 / 年份 / 系列三组**：玩法 / 机制 / 平台 / 引擎 / 标签分组与多选 UI 属于 Phase 4。
2. **作品关系未接入**：`relations` 仍只有数据层，详情页没有「相关作品」（Phase 5）。
3. **移动端只做了响应式布局**（汇总 chip 自动换行、详情属性为文本按钮），
   没有单独的移动端自动化用例；现有 UI 测试视口为 1440×1000。
4. **索引的可用条件依赖数据**：当前生产数据没有玩法 / 机制 / 平台标注，
   因此这些入口短期内只能从已标注的作品进入。
5. 没有真实数据仓网络测试；运行时同步仍由 Phase 1 的快照回退策略兜底。

## 8. 下一步：Phase 4 建议范围

按任务书「Phase 4：组合筛选和搜索增强」：

- FilterPanel 增加玩法 / 机制 / 平台 / 引擎 / 标签分组；空分组不渲染；同维多选 toggle、
  `aria-pressed`、移动端单列堆叠。
- 搜索框与结果文案更新；过滤选项只来自可见作品；不显示会永远为空的选项。
- 筛选摘要与结果总数、清除全部 / 清除失效条件保持现状。
- 断言：同维 OR / 跨维 AND / 搜索叠加 / 页码重置 / URL 载入夹紧；UI 步骤覆盖新分组。

**不做**：作品关系（Phase 5）、批量资料标注与质量检查（Phase 6）。

**请确认是否按此范围进入 Phase 4。**
