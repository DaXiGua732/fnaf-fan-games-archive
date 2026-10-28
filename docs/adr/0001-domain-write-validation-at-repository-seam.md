# Domain write validation lives at the repository seam

后台原先只有编辑器的 `validateDraft` 在把关；批量上线、列表行内切换、GameJolt 导入都直接调用仓储，
因此可以写入超过标签 / 图库 / 下载上限的数据，也能把缺少封面、Banner、下载渠道的作品置为上线。
现在领域约束收敛在 `src/utils/gameRules.ts` 的 `validateGameWrite()`，由两个仓储 adapter 的
`planCreateGame` / `planUpdateGame` 在落库前调用；编辑器的字段级校验保留，但只是同一规则的展示投影。

## Considered options

- **只在编辑器校验**：被批量 / 行内 / 导入绕过，正是本次要修的缺口。
- **每个 adapter 各写一份校验**：两个实现会漂移，且远程 409 重放时必须对最新数据重新校验。
- **在 composable 里校验**：仓储 API 的直接调用方（断言、导入、未来脚本）仍然绕过。

## Consequences

- 批量操作会把不满足条件的条目计入 `failed`，并在结果条显示原因，而不是静默写入。
- 上线门槛只在本次写入触碰 `status` / 封面 / Banner / 下载渠道时检查；历史记录里与本次编辑无关的缺口
  不会阻塞改名、改标签或归档。
- 新增写入入口必须经过仓储；直接改 `store` 或绕过 `plan*` 的代码不再受信任边界保护。
