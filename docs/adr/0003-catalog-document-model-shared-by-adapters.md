# Catalog parsing and record indexing live in one document module

两个仓储 adapter 都要把「任意 JSON 记录」变成同一份内存目录：原始记录索引、归一化作品、
记录身份问题、词表。它们原先各自实现 `indexRecords` / `normalizeGames` /
`findCatalogIdentityIssues` / `normalizeTaxonomy`，任何一处漏改都会让本地与远程对同一份数据
产生不同判断。现在 `src/repositories/catalogDocument.ts` 的 `buildCatalogDocument()` 是唯一入口；
adapter 只保留 transport（localStorage 与回滚 / GitHub Contents API 与 409 重放）。

## Considered options

- **让 `scripts/catalog-document.mjs` 也共用这个模块**：它是构建期 Node 脚本，契约刻意更窄
  （只保留顶层键、不做归一化），共用需要给它加构建步骤或引入 TS 运行时，收益不足。
  它继续由 `scripts/catalog.test.mjs` 独立守住。
- **把序列化也放进文档模块**：本地写数组 + 独立词表 key，远程写顶层对象 + 显式字段合并，
  两者格式不同；序列化留在各自 transport，文档模块只负责「读成同一份内存形态」。

## Consequences

- 本地与远程的 records / identityIssues / games / taxonomy 由同一套代码产生。
- `GameRepository` 的 interface 不变；文档模块是 adapter 后面的实现细节。
