# Admin sign-in is invite-only Supabase Auth magic link/OTP

后台目前用共享 GitHub PAT 登录，无法按人追责，也把非 GitHub 管理员挡在门外。现在改为
Supabase Auth：所有者按邮箱邀请管理员，管理员用同一封邮件里的 Magic Link 或 6 位 OTP 登录，
不设密码、不要求 GitHub 账号；登录调用 `signInWithOtp({ shouldCreateUser: false })`，未受邀邮箱
不能自助开户。首个 owner 在 Supabase 控制台手动播种。

## Consequences

- **必须接自定义 SMTP**：Supabase 内置邮件服务只有 2 封/小时，生产邀请与登录链接不可用。
- **Hash 路由必须走 PKCE**：回调使用 `?code=`，并定制邮件模板；不要把认证令牌放进 URL hash。
- **Free 计划没有会话时间盒**：会话默认不自动过期，只能由 owner 手动撤销。所有者强制 TOTP，
  editor 可选；撤销会话是离职与设备丢失时的唯一立即止损手段。若发生设备丢失或需要合规时限，
  升级 Pro 并开启绝对 / 闲置超时。
- 邀请链接与 Magic Link 默认 1 小时过期；邮件请求默认 60 秒一次。
- `service_role` 只允许出现在 Edge Function / 服务端；前端只使用 publishable/anon key 与 RLS。
- 账号行在移除管理员后保留，用于审计；不删除 `auth.users`。

## Considered options

- **继续共享 PAT**：无法多管理员、无法按人撤销，否决。
- **GitHub OAuth**：对非 GitHub 管理员门槛高，否决为主方式；以后可作为额外 provider。
- **密码登录**：需要重置 / 泄露处理，且没有比 Magic Link/OTP 更低门槛，否决。
