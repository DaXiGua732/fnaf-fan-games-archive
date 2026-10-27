# Phase 1 实施报告：数据模型与分类基础

> 日期：2026-10-27
> 状态：**Phase 1 已完成，等待确认后进入 Phase 2**
> 设计依据：`structured_data_phase0_design_freeze.md`（已确认）

## 1. 交付摘要

Phase 1 只做**数据层地基**，没有新增任何前台 / 后台界面，也没有批量修改作品数据：

- 新增玩法类型、机制、平台三套分类词表的类型、初始值与纯函数。
- 新增作品字段：`altTitles`、`sourceUrl`、`developmentStatus`、`gameplayTypes`、`mechanics`、`relations`，并启用此前一直为空的 `platforms`。
- 旧记录读取时自动补默认值；缺词表时用内置初始词表兜底，存在但为空时保持为空。
- 本地仓与 GitHub 仓实现同一套词表 / 关系语义：创建、改名、合并、删除保护、使用次数、关系校验、删除作品清理入边。
- `db.json` 从「只读写 games」升级为「整文档读写」，`taxonomy` 与未知顶层字段不会被静默抹掉。
- 新增 `test:catalog` 并纳入 `npm run verify` 与 CI。

**没有改 `src/data/db.json`，没有改数据仓，没有提交或推送。**

## 2. 数据契约

### 2.1 `db.json` 顶层

```json
{
  "games": [],
  "taxonomy": {
    "gameplayTypes": [{ "id": "traditional-night-watch", "name": "传统守夜", "description": "…" }],
    "mechanics": [],
    "platforms": []
  }
}
```

- `taxonomy` 缺失 / `null`：使用 `src/config/taxonomy.ts` 的内置初始词表，`present=false`。
- `taxonomy` 存在但集合为空：尊重空词表，**不回填**。
- 结构损坏：尽量保留合法词条并记录 issue；整块不可用时回退初始词表并记录 issue。
- 顶层未知键、词条未知字段、关系未知字段在读写和 `data:pull` 后都保留。
- **普通作品保存不会把内置词表写进数据仓**：只有词表写操作（`writeTaxonomy`）才会写入 `taxonomy`。这条有专门测试。

### 2.2 作品新增 / 启用字段

| 字段 | 默认值 | 语义 |
| --- | --- | --- |
| `altTitles` | `[]` | 其他名称；归一化去空、去重，不做数量截断 |
| `sourceUrl` | `''` | 来源页；当前只做字符串归一化，http(s) 校验留到 Phase 2 的编辑入口 |
| `developmentStatus` | `'unknown'` | 作品开发进度：`released` / `in-development` / `on-hold` / `cancelled` / `unknown` |
| `gameplayTypes` | `[]` | 玩法类型词条 id；第一个是主要类型（当前数据层只存顺序，不强制） |
| `mechanics` | `[]` | 机制词条 id |
| `platforms` | `[]` | 平台词条 id；历史数据里直接写平台名也能按名称解析 |
| `relations` | `[]` | 有向关系边：`{ type, targetId }` |

**`developmentStatus` 与 `status` / `archived` 是两套概念**：前者描述作品本身做到哪一步，后者只控制本站是否展示；二者不互相推导。

### 2.3 词表

- 词条形状：`{ id, name, description }`；id 创建后不可改，`name` 可改。
- 同集合按 NFKC + 小写 + 折叠空白判重；跨集合同名只提示，不阻止保存。
- 改名不改作品；合并会把来源 / 目标的历史名称写法统一成目标 id 并去重；删除仍被引用的词条默认拒绝，除非明确 `removeFromGames`。
- 初始词表只作为运行时兜底，不等于已经给任何作品打了标签。

### 2.4 本地存储

- 作品存档：`fnaf-archive:admin-catalog:v1`（不变，旧存档继续可读）。
- 词表存档：`fnaf-archive:taxonomy:v1`（新增，单独 key，不改变旧数组格式）。
- `hydrate(games, taxonomy?)` 只替换内存，不持久化；`resetToSeed()` 同时重置作品与词表。

## 3. 仓储与同步行为

### 3.1 Repository 契约

`GameRepository` 新增：

```ts
taxonomy: ComputedRef<Taxonomy>
taxonomyIssues: ComputedRef<string[]>
hydrate(games: AdminGame[], taxonomy?: Taxonomy): void
createVocabularyEntry(collection, input): Promise<VocabularyEntry>
updateVocabularyEntry(collection, id, patch): Promise<VocabularyEntry>
mergeVocabularyEntries(collection, sourceId, targetId): Promise<VocabularyMutationResult>
deleteVocabularyEntry(collection, id, options?): Promise<VocabularyMutationResult>
```

### 3.2 本地仓

- 首次读取：本机词表存档 → `db.json` 的 `taxonomy` → 内置初始词表。
- 词表与作品在同一个 `persist()` 里写入；写失败降级为 `memory`，**不假装成功**。
- 词表方法调用纯函数后一次性更新内存并持久化。
- `createGame` / `updateGame` 先校验关系输入，再对完整目录做关系校验（自关联、重复、目标不存在、目标端已有反向记录都会拒绝）。
- `deleteGame` 在同一操作里清理所有指向它的关系。

### 3.3 GitHub 仓

- 读取：解析整个 `db.json`，保留 `raw` 顶层对象；作品和词表分别归一化。
- 写入：始终在最新内容上重放改动；409 冲突最多重试 3 次。
- 序列化：`{ ...raw, games }`；只有词表操作才设置 `taxonomy`。因此数据仓原本没有词表时，普通保存作品不会新增 `taxonomy`。
- 作品保存前校验关系输入与完整目录；删除作品时在同一提交内清理入边。
- 词表创建 / 改名 / 合并 / 删除都是原子提交，合并 / 删除同时更新作品。

### 3.4 同步与构建快照

- `hydratePublicCatalog()` 同时接收 `games` 与 `taxonomy`；词表缺失或不可用时保留当前词表，不把站点变成空词表。
- `scripts/pull-data.mjs` 现在解析 / 序列化整个文档，保留 `taxonomy` 与未知顶层键；`games` 为空或 JSON 不可解析时拒绝落盘。
- 代码仓的 `src/data/db.json` **未改**：可以没有 `taxonomy`，运行时用内置初始词表；第一次后台词表保存才会写进数据仓。

## 4. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:gamejolt` | 22/22（未改 GameJolt 逻辑） |
| `npm run test:catalog` | 3/3 |
| `npm run build:extension` | 通过 |
| `npm run selftest` | **740/740**（Phase 1 新增 133 条结构化断言） |
| `npm run smoke` | 14/14 |
| `npm run build` | 通过 |
| `npm run verify` | 全部通过（含 build） |
| `npm run test:ui` | **81/81**（另起 dev server + 系统 Chrome；未改 UI，回归通过） |

断言覆盖的关键分支：

- 旧记录缺字段读取；非法开发状态回退 `unknown`；列表归一化不截断。
- 关系归一化 / 自关联 / 重复目标 / 不存在的目标 / 目标端反向记录；删除作品清理入边。
- 词表缺失、空、损坏、重复 id / 名称、未知字段保留；id 优先、名称兜底解析。
- 创建 / 改名 / 合并 / 删除保护 / 强制移除引用 / 使用次数 / 未分类统计。
- 本地仓储：种子、持久化、hydrate 不落盘、损坏回退、reset、关系校验与删除清理。
- GitHub 桩：加载词表、词表写入保留未知顶层键、普通保存不注入词表、409 重放保留同侪改动与未知键、合并原子性。

> UI 测试为 Phase 1 完成后的回归运行；Phase 1 本身没有增加 UI 用例。新增数据的可视化编辑与词表页在 Phase 2 验收时补 UI 测试。

### 独立只读审查后的修复

实现完成后做了一轮独立只读审查，确认并修复了 8 个问题（均已补断言）：

- 普通作品保存不再改写数据仓里已存在的 `taxonomy`，包括 `null` / `[]` / 结构损坏的情况；只有词表操作才写词表。
- 关系校验只在本次提交了 `relations` 时执行；历史悬挂 / 双端关系不再阻塞状态、归档等无关字段的保存。
- 词表归一化增加 `usable` 标记；缺集合 / 集合类型不对的词表不会在公开 hydrate 时清空当前词表，本地存档会回退初始词表。
- `GamePatch` 中显式 `undefined` 不再清空新字段或把已有作品的 `status` 打回 `published`；新建作品即使显式传 `status: undefined` 也仍是草稿。
- 修复「名称已被别的集合占用时，当前集合内重复名称漏检」的词表归一化漏洞。
- 本地仓两个 localStorage key 写入失败时做尽力回滚；无法回滚仍如实降级为 `memory`。
- 新建作品时先算出 id 再校验关系，目标恰好等于新 id 会报错，不再被当成自关联静默丢弃。
- selftest 的静态守卫改用真实存在的 `GitHub` 仓储命名，并清理了 `remoteGameRepository.ts` 幽灵白名单。

## 5. 修改文件

**新增**

- `src/types/taxonomy.ts`
- `src/config/taxonomy.ts`
- `src/utils/taxonomy.ts`
- `src/utils/relations.ts`
- `src/dev/structuredDataAssertions.ts`
- `scripts/catalog-document.mjs`
- `scripts/catalog.test.mjs`
- `structured_data_phase1_report.md`（本文件）

**修改（Phase 1 相关部分）**

- 类型 / 默认值：`src/types/game.ts`、`src/types/admin.ts`、`src/utils/gameDefaults.ts`、`src/utils/gameFactory.ts`
- 仓储：`src/repositories/gameRepository.ts`、`src/repositories/localGameRepository.ts`、`src/repositories/githubGameRepository.ts`、`src/repositories/index.ts`
- 同步 / 门禁：`scripts/pull-data.mjs`、`scripts/selftest.mts`、`package.json`、`.github/workflows/deploy.yml`
- 文档：`README.md`、`HANDOVER.md`、`structured_data_phase0_design_freeze.md`（仅保留 Phase 0 设计，未改结论）

> 工作区还包含此前未提交的主题 / 催资源改动，因此 `git status` 的范围大于本报告；Phase 1 没有提交或推送。

## 6. 已知限制

1. **没有 UI**：编辑页不显示新字段，前台没有玩法 / 机制 / 平台索引，详情页不展示关系。现有作品的新字段为空。
2. **没有批量标注**：当前数据稀疏，自动分类会造假；分类与关系必须由管理员按证据手工录入。
3. **编辑器限额与 URL 校验尚未接入**：玩法 ≤3、机制 ≤12、平台 ≤8、其他名称 ≤5、关系 ≤20，以及 `sourceUrl` 的 http(s) 校验属于编辑入口职责，Phase 2 实现。数据层归一化刻意不截断，避免旧记录被静默删减。
4. **词表尚未写进数据仓**：这是有意的。普通作品保存不会注入内置词表；第一次词表保存才会创建 `taxonomy`。
5. **关系编辑 / 展示**：按任务书归入 Phase 5；Phase 1 只完成数据结构、校验与仓储清理。
6. **没有真实 GitHub / Supabase 网络测试**：并发与 409 由注入 fetch 的桩覆盖；真实数据仓操作仍需在部署后按运维流程验证。

## 7. 下一步：Phase 2 建议范围

按任务书「Phase 2：后台分类与资料编辑」与冻结设计，建议只做：

- 新增 `/admin/vocabulary`：玩法类型 / 机制 / 平台三个分区；新建、改名、改定义、合并、删除保护、使用次数、未分类计数、重名与跨集合提示。
- 编辑器新字段：其他名称、来源页、开发状态、玩法类型（≤3，标出主要）、机制（≤12）、平台（≤8）；复用现有草稿态、预览与结果提示条。
- 草稿白名单与校验：`emptyDraft` / `DRAFT_FIELDS` / `applyDraft` / `gameToDraft` / `draftToPatch` 等同步更新；非法词条 id、超上限、非法 URL 阻断保存。
- 测试：词表 CRUD / 合并 / 删除保护的 selftest 与 UI 用例；编辑器新字段往返与预览；smoke 新路由。
- 不做：前台索引 / 组合筛选（Phase 3–4）、作品关系编辑与展示（Phase 5）、批量资料标注。

**请确认是否按此范围进入 Phase 2。**
