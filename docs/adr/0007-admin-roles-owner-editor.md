# Admin roles are owner and editor; destructive actions stay with owners

后台需要多人协作，但不能把「删库 / 改权限」和「改内容」放在同一权限层。现在只有两个角色：
`owner` 负责管理员与破坏性操作（邀请 / 移除 / 改角色、永久删除 / 恢复、删除标签或作者、
合并 / 删除词条、查看审计）；`editor` 负责内容（创建 / 编辑 / 发布 / 归档、图片、标签与作者改名合并、
词表新建改名）。

作品删除改为**软删除**：`deleted_at` / `deleted_by`，后台默认与公开站都排除，owner 可恢复或永久清除。
归档仍是独立、editor 可用的可逆操作。最后一个 owner 不能被移除或降级。

## Consequences

- RLS / RPC 必须按角色矩阵强制；UI 隐藏按钮只影响体验，不是授权。
- 破坏性动作需要 `aal2`（owner 强制 TOTP）；editor 自愿开启后同样要求 `aal2`。
- 审计表追加写；owner 可读，editor 不可读。
- 新增后台动作时必须先归入矩阵：内容 → editor，管理 / 不可逆 → owner。
