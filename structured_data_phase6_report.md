# Phase 6 实施报告：集成验证与资料质量检查

> 日期：2026-10-27
> 状态：**Phase 6 已完成。结构化资料库升级 Phase 0–6 全部交付**
> 设计依据：`structured_data_phase0_design_freeze.md`、`structured_data_phase5_report.md`

## 1. 交付摘要

Phase 6 收尾，没有新增前台 / 后台业务功能：

- 新增**只读**资料质量检查 `npm run check:data`：报告未分类、失效词条、关系异常、
  重复项、缺失资料、词表结构问题；**不写文件、不调用 GitHub API、不改数据**。
- 提取公开可见性判据到 `src/utils/visibility.ts`，前台深模块与质量检查共用同一条规则。
- 提取 `isRecord` 到 `src/utils/guards.ts`，结构化工具不再各自维护一份。
- 跨模块回归：旧记录兼容、公开可见性、组合筛选、关系方向 / 反向 / 删除清理
  继续由 selftest + smoke + UI 覆盖。
- 文档更新：README / HANDOVER / 各阶段报告，修正断言条数与门禁说明。

## 2. 只读质量检查

### 2.1 用法

```bash
npm run check:data                         # 检查 src/data/db.json
npm run check:data -- --file=db.json       # 检查任意 db.json（只读）
npm run check:data -- --json               # 机器可读输出
npm run check:data -- --strict             # 有 error 时退出码 1（默认总是 0）
```

### 2.2 检查项

| 类别 | 代码 | 级别 |
| --- | --- | --- |
| 结构 | `catalog-games-missing` / `game-invalid` / `game-duplicate-id` | error |
| 必填 | `missing-title` / `missing-author` | error |
| 资料完整度 | `missing-cover` / `missing-banner` / `missing-downloads` | warning |
| 分类 | `unclassified` / `unknown-vocabulary` | warning / error |
| 标签 | `tag-overlaps-vocabulary` / `duplicate-tag` / `duplicate-alt-title` / `duplicate-platform` | warning |
| 关系 | `relation-self` / `relation-dangling` / `relation-invalid-type` / `relation-duplicate` / `relation-empty-target` / `relation-not-array` | error |
| 关系 | `relation-reverse-duplicate` / `relation-limit` | warning |
| 关系 | `relation-target-hidden` | info（后台保留、前台不展示） |
| 字段 | `invalid-development-status` / `implausible-year` | warning |
| 词表 | `taxonomy-missing` / `unused-vocabulary` | info |
| 词表 | `taxonomy-unusable` | error |
| 词表 | `taxonomy-issue` / `overlapping-vocabulary` | warning |

### 2.3 当前快照的实际结果

```text
作品 4 条（可见 3 / 隐藏 1） · 词条 13 个 · 未分类 4 条
error 0 · warning 7 · info 14
```

- 4 条作品都没有标注玩法类型（预期：数据尚未人工标注）。
- 《Jolly 4》缺封面、Banner、下载渠道。
- 数据里没有 `taxonomy`，检查使用内置初始词表；初始词条全部未被使用。
- **没有 error**，说明当前数据不存在悬挂关系 / 失效词条等结构性问题。

## 3. 集成验证

Phase 6 没有引入新的查询或写入路径，回归范围覆盖此前各阶段：

- **旧数据兼容**：`normalizeGame()` 对稀疏记录的默认值断言；本地仓储用真实快照种子；
  编辑器打开旧记录不丢字段。
- **公开可见性**：`isPubliclyVisible()` 单点判据被前台列表、筛选元数据、索引、
  关系目标、质量检查共用；草稿 / 下线 / 归档不会经任何入口泄漏。
- **组合筛选**：同维 OR / 跨维 AND / 搜索叠加 / 页码重置 / URL 夹紧与失效条件。
- **关系**：方向文案、反向派生、自关联 / 无效目标 / 重复 / 两端重复、删除清理、
  隐藏目标不展示、同作者 / 同系列去重。

## 4. 修改文件

**新增**

- `src/utils/dataQuality.ts`（纯函数分析器）
- `scripts/data-quality.mts`（CLI 包装）
- `src/dev/dataQualityAssertions.ts`（30 条断言）
- `src/utils/visibility.ts`（共享可见性判据）
- `src/utils/guards.ts`（共享 `isRecord`）
- `structured_data_phase6_report.md`（本文件）

**修改**

- `src/composables/useGameLibrary.ts`：改用共享可见性判据并保留原导出
- `src/utils/relations.ts`、`src/utils/taxonomy.ts`：改用共享 `isRecord`
- `scripts/selftest.mts`：新增资料质量断言组
- `package.json`：新增 `check:data`
- `README.md`、`HANDOVER.md`

## 5. 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:gamejolt` | 22/22 |
| `npm run test:catalog` | 3/3 |
| `npm run build:extension` | 通过 |
| `npm run selftest` | **880/880**（新增 30 条质量检查断言） |
| `npm run smoke` | **16/16** |
| `npm run build` | 通过 |
| `npm run verify` | 全部通过 |
| `npm run test:ui` | **99/99** |
| `npm run check:data` | error 0 · warning 7 · info 14（当前快照） |

## 6. 已知限制

1. 质量检查只读，不提供一键修复；问题需由管理员在后台逐条处理。
2. 检查基于数据文件本身，不做跨数据仓 / 历史提交比较。
3. 生产数据仍没有任何玩法 / 机制 / 平台标注与作品关系，这是**资料缺失**，
   不是代码缺陷；需要按证据人工录入。
4. `check:data` 未纳入 `npm run verify`：真实数据可能长期带有 warning，
   不应让部署门禁因资料完整度失败；需要严格检查时用 `--strict`。
5. 真实 GitHub / Supabase 行为仍未做网络级测试，沿用此前的桩与手动运维流程。

## 7. 结构化资料库升级总结

| Phase | 交付 |
| --- | --- |
| 0 | 审计、字段 / 词表 / 关系 / URL / 风险设计冻结 |
| 1 | 类型、默认值、词表、关系、两套仓储、同步兼容、测试地基 |
| 2 | `/admin/vocabulary`、编辑器新字段、预览展示 |
| 3 | 详情页可点击索引、八维查询、URL 状态、失效条件 |
| 4 | 八组筛选面板、同维多选、移动端 |
| 5 | 关系编辑、校验、详情页相关作品、同作者 / 同系列 |
| 6 | 只读质量检查、共享规则、集成回归、文档收尾 |

Phase 0–6 按设计完成，没有批量修改生产数据，没有引入新的长期运行服务。
