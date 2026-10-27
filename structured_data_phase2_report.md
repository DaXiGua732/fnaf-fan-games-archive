# Phase 2 实施报告：后台分类与资料编辑

> 日期：2026-10-27
> 状态：**Phase 2 已完成，等待确认后进入 Phase 3**
> 设计依据：`structured_data_phase0_design_freeze.md`、`structured_data_phase1_report.md`

## 1. 交付摘要

Phase 2 把 Phase 1 的数据能力接进后台，**没有改前台索引、组合筛选或作品关系**：

- 新增 `/admin/vocabulary`：玩法类型 / 游戏机制 / 支持平台三分区，支持新建、改名、
  改定义、合并、删除保护、使用次数（全部作品 / 前台可见）、未分类计数、跨集合同名提示。
- 编辑器新增：其他名称、来源页、开发状态、玩法类型（≤3，第一项为主要）、机制（≤12）、
  平台（≤8）。词条只能从受控词表选择，不能在作品编辑器里顺手新建。
- 草稿链路完整接入新字段：`GameDraft` / 空白草稿 / 基线复制 / 脏检查 / 校验 / 保存 /
  「撤销修改」全部覆盖；旧记录打开编辑器不会丢字段。
- 详情页与后台预览按词表把 id 解析成名称后展示；来源页只对 http(s) 生成外链。
- 新增 34 条 selftest 断言、6 步 UI 点击用例、1 条 SSR 冒烟路由。

**没有改 `src/data/db.json`，没有改数据仓，没有给任何作品自动打分类。**

## 2. 后台词表页

**路由**：`/#/admin/vocabulary`（`admin-vocabulary`），导航名「玩法与机制」。
与「标签与作者」刻意分开：后者是作品上的派生字符串，前者是有稳定 id 的受控词条。

**每个分区包含**：

| 能力 | 行为 |
| --- | --- |
| 新建 | 名称必填；定义选填；稳定标识选填（留空按名称生成，中文名退化为集合前缀 + 序号） |
| 编辑 | 改名 + 改定义；作品引用的是 id，改名不触碰作品 |
| 合并 | 选择同分区目标；一次提交内替换并去重所有作品引用，再删除来源 |
| 删除 | 未被引用可直接删；仍被引用时默认拒绝，必须「合并」或「从作品移除并删除」 |
| 使用次数 | 「N 款 · 前台可见 M」，只从当前仓储快照派生 |
| 未分类 | 顶部显示「未标玩法 X / Y 款」，只提示，不阻止保存 |
| 重名 | 同集合重名由仓储拒绝；跨集合同名给出提示但不阻止（「解谜」可能既是玩法又是机制） |
| 数据问题 | `taxonomyIssues` 原样展示缺集合 / 重复 id / 同名等结构问题 |

搜索按「名称 + 定义」过滤，逻辑在 `useVocabulary.search()`，视图不写 `.filter()`。

## 3. 编辑器新字段

| 字段 | 控件 | 上限 / 校验 | 未填时 |
| --- | --- | --- | --- |
| 其他名称 `altTitles` | chip 录入 | 5 个，单个 80 字符；超限阻止保存 | 不显示 |
| 来源页 `sourceUrl` | URL 输入 | http(s) 完整链接，≤300 字符 | 不显示 |
| 开发状态 `developmentStatus` | 下拉 | 5 个固定值 | `unknown`（不显示） |
| 玩法类型 `gameplayTypes` | chip 多选 | 3 个；第一项为主要，可「设为主要」 | 不分类 |
| 游戏机制 `mechanics` | chip 多选 | 12 个 | 不显示 |
| 支持平台 `platforms` | chip 多选 | 8 个；历史名称写法按「先 id、再名称」解析 | 不显示 |

**阻断 vs 提示**：

- 阻断保存：非法 URL、超上限、失效词条 id（草稿里残留已被合并 / 删除的 id）。
- 只提示：未标玩法 / 机制 / 平台、未填来源页 / 其他名称、未标开发状态。

开发状态与网站发布状态保持正交：`isPubliclyVisible()` 仍只看 `status` / `archived`，
`developmentStatus` 永远不参与发布、下线或归档判断。

**预览**：`draftToPatch()` 带出全部新字段；预览打开真实 `GameDetail`，
侧栏按词表解析名称展示，来源页用 `target="_blank" rel="noopener noreferrer"`。

## 4. 数据与仓储

- 没有新增数据层概念：词表读写仍走 `GameRepository`，本地仓 / GitHub 仓语义一致。
- 新字段全部 optional，`normalizeGame()` 补默认值；旧记录**零迁移**。
- 编辑器保存走 `draftToPatch()` 的显式字段清单，不会把未编辑字段覆盖成默认值。
- 词表上限集中在 `GAME_VOCABULARY_LIMITS` / `ALT_TITLE_LIMITS`；
  数据层归一化仍然**不截断**，避免旧记录被静默删减。

## 5. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:gamejolt` | 22/22（未改 GameJolt 逻辑） |
| `npm run test:catalog` | 3/3 |
| `npm run build:extension` | 通过 |
| `npm run selftest` | **774/774**（Phase 2 新增 34 条） |
| `npm run smoke` | **15/15**（新增 `/admin/vocabulary`；编辑器断言新字段区块） |
| `npm run build` | 通过 |
| `npm run verify` | 全部通过（含 build） |
| `npm run test:ui` | **87/87**（新增 6 步：词表新建 / 编辑 / 合并 / 删除保护 / 结构化字段往返 / 预览展示） |

UI 用例覆盖的关键路径：

1. 词表页三分区与内置词条渲染。
2. 新建机制 → 列表出现、使用次数 0；改名后列表更新。
3. 新建第二个词条并把第一个合并进去：来源消失、目标保留。
4. 把词条挂到作品上 → 删除被拒绝（显示「仍被 1 款作品使用」）→
   「从作品移除并删除」→ 作品上的引用同步消失。
5. 编辑器设置玩法 / 机制 / 平台 / 其他名称 / 来源页 / 开发状态 → 保存 →
   重新加载后值一致；玩法第一项标为「主要」。
6. 预览新标签页按词表名称展示六个新字段。

## 6. 修改文件

**新增**

- `src/views/admin/AdminVocabulary.vue`
- `src/components/admin/AdminVocabularyPicker.vue`
- `src/components/admin/AdminAltTitleEditor.vue`
- `src/composables/useVocabulary.ts`
- `structured_data_phase2_report.md`（本文件）

**修改**

- 编辑器链路：`src/types/admin.ts`、`src/types/taxonomy.ts`、
  `src/composables/useAdminGameDraft.ts`、`src/views/admin/AdminGameEditor.vue`
- 前台展示：`src/composables/useGameLibrary.ts`、`src/views/GameDetail.vue`
- 路由 / 导航：`src/router/routes.ts`、`src/components/admin/AdminNav.vue`
- 测试：`src/dev/adminAssertions.ts`、`scripts/smoke.ts`、`scripts/ui-test.mjs`
- 文档：`README.md`、`HANDOVER.md`

## 7. 已知限制

1. **前台索引未实现**：详情页的玩法 / 机制 / 平台 / 作者等仍是静态文字，
   不能点击进入筛选结果（Phase 3）。URL 筛选状态、组合筛选、搜索扩展属于 Phase 3–4。
2. **作品关系未接入**：`relations` 仍只能由数据层维护，编辑器没有关系区块，
   详情页没有「相关作品」（Phase 5）。
3. **没有批量标注**：词表不绑定任何作品；分类必须由管理员按资料逐条录入。
4. **词表尚未写进数据仓**：代码仓快照与生产数据仓都还没有 `taxonomy`；
   第一次后台词表保存会创建它。内置初始词表只是运行时兜底。
5. **没有真实 GitHub / Supabase 网络测试**：词表写入的 409 重放由 Phase 1 的桩覆盖；
   真实数据仓行为仍需部署后按运维流程验证。
6. **UI 测试依赖本机 Chrome**：不在 CI 内，需要 `npm run dev` + `npm run test:ui` 本地执行。

## 8. 下一步：Phase 3 建议范围

按任务书与冻结设计，Phase 3 只做**前台可点击属性索引**：

- `useGameLibrary` 查询状态从单值改为多值数组，新增 `gameplay / mechanic / tag / platform / engine`
  维度与 `available*` 元数据；搜索覆盖玩法 / 机制 / 平台名称与 `altTitles`。
- `src/utils/filterUrl.ts`：query ↔ 查询状态纯函数；默认值不写进 URL，多值用重复参数。
- 详情页作者 / 年份 / 系列 / 引擎 / 平台 / 玩法 / 机制 / 标签转为索引入口；
  点击时清空其他条件、`push` 到首页并滚动到游戏库。
- 首页 URL 同步（页面内 `replace`）、无效词条 id 提示与清除、空结果状态。

**不做**：FilterPanel 新分组与多选 UI（Phase 4）、作品关系（Phase 5）、批量标注（Phase 6）。

**请确认是否按此范围进入 Phase 3。**
