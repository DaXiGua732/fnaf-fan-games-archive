# The admin catalog stays a module singleton; drafts take an injected repository

`useAdminGames` 的状态（查询、勾选、批量结果）就是「当前后台唯一一份目录」的产品语义：
列表页与编辑页必须看到同一份数据。把它改成 `createAdminGames(repository)` 只会为一个
不存在的产品需求（同时打开两份后台目录）增加参数，并把 1000+ 行模块状态搬进工厂。
测试已经可以通过 `createLocalGameRepository({ storage: null })` + `hydrate()` 构造隔离目录。

编辑草稿不同：它本来就是**每次编辑会话一个实例**，所以 `useAdminGameDraft({ repository })`
接受注入；默认仍使用当前后台仓储。断言因此可以在隔离目录上创建草稿，不需要改全局夹具。

## Consequences

- 新增后台目录级能力时继续扩展 `useAdminGames` 单例；不要因为测试方便就引入工厂。
- 如果将来真的需要并行的多份后台目录（多租户 / 对比编辑），再把这个决策改成
  `createAdminGames` 并更新本 ADR。
