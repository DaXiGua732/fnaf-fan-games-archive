# The catalog write transaction is a shared pure plan

`localGameRepository` 与 `githubGameRepository` 原先各自实现「校验 → applyPatch → 检测关系变化 →
buildGameWritePatch → 提交摘要」。两份事务会随写入语义变化而漂移。现在事务收敛在
`src/utils/gameWrite.ts` 的 `planCreateGame` / `planUpdateGame` / `planDeleteGame`：输入是当前目录与
`GamePatch`，输出是 next games、要合并进原始记录的 write patch、提交摘要与关系变更标记。
adapter 只保留 transport —— 本地 localStorage 写入与回滚，远程 GitHub Contents API 的 fetch / 409 重放。

## Consequences

- 远程 409 重放时，计划在新读到的目录上重新执行，因此校验与摘要总是针对最新内容。
- 本地与远程的 create / update / delete 行为由同一组断言覆盖；新增写入规则只改一个模块。
- `GameRepository` 的 interface 仍是写入 seam；计划是它后面的实现，不暴露给视图。
