# Authorization is RLS + security-definer RPCs, with a session check on every write

开源客户端意味着攻击者能看到全部表名、RPC 与 UI 判断；因此授权不能靠隐藏，只能靠服务端。
所有表开启 RLS 并撤销 `anon` / `authenticated` 的直接写权限；写操作只暴露 `security definer`
RPC，RPC 内重新读取 `admin_roles`、检查当前会话仍在 `auth.sessions` 中，并对 owner 专属操作要求
`aal2`。公开读走 `security_invoker` 视图，只暴露已上线、未软删除的作品与被可见作品引用的词条。

## Consequences

- 撤销管理员后，旧 access token 在下一次写操作就被拒绝，不必等 1 小时 JWT 过期。
- 每次写多一次 `auth.sessions` 索引查询；管理员数量很小，成本可接受。
- 限流计数从 append-only 审计日志推导，客户端无法伪造。
- 审计永久保留、只追加；owner 可读，editor 不可读。
- 新增 RPC 必须重复同一套检查；漏掉就是越权。测试矩阵 #10 负责证明没有漏。
- `service_role` 只用于迁移与 Edge Function（邀请邮件），绝不进入前端。
