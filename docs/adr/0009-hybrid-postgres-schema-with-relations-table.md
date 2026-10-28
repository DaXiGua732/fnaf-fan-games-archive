# A hybrid Postgres schema with a real relations table

目录条目有 20+ 个字段，其中大量是数组（标签、图库、下载、词表引用）。全部拆成关联表会让每次读写
都要多表 join，单 JSONB 又会让约束和索引变弱。现在采用混合模型：标量字段是列，数组 / 对象是 JSONB；
作品之间的有向关系单独建 `game_relations` 表，用外键和 `(game_id,target_id)` 主键保证不悬空、不重复。

写操作每个动作一个 `security definer` RPC；公开读走安全视图；管理员读也要检查角色与活跃会话；
审计表只追加。schema 变更放入 `supabase/migrations/`。

## Consequences

- JSONB 数组的成员合法性由写 RPC 校验；数据库只保证它是数组，不能替代 RPC 校验。
- `game_relations` 的外键会在永久删除时级联清理；软删除被外键视为仍存在，恢复不会丢边。
- 管理员读与写都检查 `auth.sessions`；撤销后草稿也不会继续被读到。
- 新增动作必须同时新增 RPC、审计分支和限流分支；只加 UI 不会获得权限。
