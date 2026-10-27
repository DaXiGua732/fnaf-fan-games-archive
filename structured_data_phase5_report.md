# Phase 5 实施报告：作品关联关系

> 日期：2026-10-27
> 状态：**Phase 5 已完成，等待确认后进入 Phase 6**
> 设计依据：`structured_data_phase0_design_freeze.md`、`structured_data_phase4_report.md`

## 1. 交付摘要

Phase 5 把 Phase 1 定义的关系数据结构接进后台与前台：

- 编辑器新增「关联作品」区块：关系类型 + 作品选择器（标题 / id / 作者搜索），
  只允许选择已有作品；排除自身与已选目标。
- 关系校验与仓储共用 `inspectGameRelations()`：自关联、目标不存在、重复目标、
  目标端已有反向记录、数量上限（20）都会阻断并显示在对应行。
- 详情页新增「相关作品」：出边文案、入边反向文案、同作者、同系列；
  只展示公开可见目标；与显式关系去重；没有数据时整段不渲染。
- 后台预览使用同一个 `GameDetail`，关系目标按公开可见性解析。

**没有新增路由，没有改数据仓，没有批量建立任何关系。**

## 2. 数据与校验

关系仍是一条**有向边**：`{ type, targetId }`，存放在当前作品上。

| 类型 | 本作页文案 | 目标页反向文案 |
| --- | --- | --- |
| `prequel` | 前传 | 续作 |
| `sequel` | 续作 | 前传 |
| `remake` | 重制版 | 重制原作 |
| `reboot` | 重启作品 | 重启原作 |
| `spin-off` | 衍生作品 | 衍生作品 |
| `same-universe` | 同一世界观 | 同一世界观 |
| `related` | 相关作品 | 相关作品 |

保存前检查（编辑器与仓储同一套规则）：

1. 关系类型合法、目标非空、不能是自身。
2. 目标必须存在于**全部作品**（含草稿 / 下线 / 归档）。
3. 同一作品内同一目标只能出现一次。
4. 目标作品的 `relations` 里已有指向本作的关系 → 拒绝，避免两端各存一条。
5. 最多 20 条；超限阻断保存。
6. 目标不可见不阻断保存，但编辑器标注「前台暂不展示」。

`utils/relations.ts` 现在导出：

- `inspectGameRelations()`：`{ rowErrors, errors }`；
- `validateGameRelations()`：仓储使用的整体错误（行为不变）；
- `explicitRelatedWorks()`：出边 + 入边反向文案 + 可见性过滤 + 去重；
- `sameAuthorWorks()` / `sameSeriesWorks()`：派生展示、排除集合、6 条上限。

## 3. 后台编辑器

`AdminRelationEditor`：

- 已选关系逐行显示：关系文案、目标标题、年份、作者、状态；
  隐藏目标会提示「前台暂不展示」，失效目标提示移除。
- 添加区：关系类型下拉 + 搜索框 + 候选按钮（标题 / 年份 / 状态）；
- 上限与错误提示在区块内展示；不能手输 id。
- 关系进入草稿脏检查、撤销、保存、预览与重新加载。

## 4. 前台详情页

- 「相关作品」分三段：关联作品 / 同作者的其他作品 / 同系列的其他作品；
  每段只在非空时渲染，整段外部在完全无数据时也不出现。
- 关联作品卡片：关系文案 + 封面 + 标题 + 年份 + 作者，点击进入目标详情。
- 入边反向文案由目标端一条记录派生，数据里不需要存两条。
- 显式关系目标不在 `visibleGames` 中则不展示 —— 草稿 / 下线 / 归档不会经关联模块泄漏。
- 同作者 / 同系列由 `author` / `ipSeries` 派生，按年份降序 + 标题排序，各限 6 条；
  与显式关系、同作者结果去重，避免同一作品在多个分区重复出现。
- 「同一世界观」只认显式 `same-universe`，不根据标签相似自动认定。

## 5. 修改文件

**新增**

- `src/components/admin/AdminRelationEditor.vue`
- `structured_data_phase5_report.md`（本文件）

**修改**

- 数据类型 / 草稿：`src/types/game.ts`（`RELATION_LIMITS`）、`src/types/admin.ts`、
  `src/composables/useAdminGameDraft.ts`
- 关系规则：`src/utils/relations.ts`（逐行检查 + 派生展示）
- 界面：`src/views/admin/AdminGameEditor.vue`、`src/views/GameDetail.vue`
- 测试：`src/dev/adminAssertions.ts`、`src/dev/structuredDataAssertions.ts`、
  `scripts/smoke.ts`、`scripts/ui-test.mjs`
- 文档：`README.md`、`HANDOVER.md`

## 6. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:gamejolt` | 22/22 |
| `npm run test:catalog` | 3/3 |
| `npm run build:extension` | 通过 |
| `npm run selftest` | **850/850**（Phase 5 新增 26 条） |
| `npm run smoke` | **16/16** |
| `npm run build` | 通过 |
| `npm run verify` | 全部通过 |
| `npm run test:ui` | **99/99**（新增 2 步关联用例） |

UI 覆盖：

1. 后台打开编辑页 → 选择类型与目标 → 添加 → 保存 → 重新加载仍在；
   预览新标签页显示「续作」与目标作品；移除并保存后恢复空状态。
2. 公开详情页：A 页显示「续作 B」、同作者 C、同系列 D；草稿目标不出现；
   B 页显示反向「前传 A」；无关系的 E 页整段不渲染；点击相关作品跳到目标页。

selftest 额外覆盖：逐行错误对齐、重复 / 反向 / 缺失目标、出边与入边文案、
不可见目标过滤、同作者 / 同系列派生与去重、草稿添加 / 移除 / 自关联 / 重复 / 反向拒绝、
保存片段包含关系。

## 7. 已知限制

1. 关系选择器最多显示 8 个候选；输入关键词可缩小范围。
2. 编辑器只能建立「当前作品 → 已有作品」的关系；要建立反方向请到目标作品操作。
3. 无法在关系区块直接新建目标作品（需先到游戏管理新建）。
4. 生产数据目前没有关系记录；需要管理员按资料逐条录入。
5. Phase 6 的只读质量检查（悬挂关系、未分类、重复词条）尚未实现。

## 8. 下一步：Phase 6 建议范围

- 只读资料质量检查：未分类作品、失效词条引用、悬挂关系、重复 / 近义分类、
  缺封面 / 下载等（只报告，不改数据）。
- 跨模块集成回归：旧数据兼容、公开可见性、组合筛选、关系方向与删除清理。
- 文档收尾：字段语义、URL 参数、关系方向、初始词表、已知限制；
  修正文档与测试门禁之间的不一致。
- 不批量修改生产数据；如需修复，由管理员在后台逐条处理。

**请确认是否按此范围进入 Phase 6。**
