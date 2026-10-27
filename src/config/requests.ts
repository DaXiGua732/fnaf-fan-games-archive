/**
 * 催资源的远程存储配置
 *
 * ---------------------------------------------------------------------------
 * 如何启用 Supabase（全站共享）
 * ---------------------------------------------------------------------------
 * 1. 在 Supabase SQL Editor 里执行 `supabase/resource_requests.sql`；
 * 2. 在项目根目录新建 `.env.local`（不要提交），写入：
 *
 *      VITE_SUPABASE_URL=https://<project-ref>.supabase.co
 *      VITE_SUPABASE_ANON_KEY=<Project Settings → API → anon public key>
 *
 * 3. 重新启动 `npm run dev` 或重新构建。
 *
 * 两个变量都为空时，站点使用**本机模式**：请求只保存在当前浏览器里。
 *
 * ---------------------------------------------------------------------------
 * 关于密钥
 * ---------------------------------------------------------------------------
 * anon key 是设计为公开的浏览器密钥，权限由数据库的 RLS / GRANT 决定；
 * 它出现在前端代码里是正常的。
 *
 * **绝对不要**把 `service_role` key 放进这里或任何前端文件 —— 它会绕过 RLS，
 * 等于把整个数据库的写权限交给所有访客。本项目只使用 anon key。
 *
 * 不想用环境变量时，也可以直接在下面两个空字符串里填值；环境变量优先。
 */

/** 直接编辑时可填这里；通常留空，改用 .env.local */
const HARDCODED_SUPABASE_URL = ''
const HARDCODED_SUPABASE_ANON_KEY = ''

let envUrl = ''
let envAnonKey = ''

// 直接访问 `import.meta.env.VITE_...`：Vite 会在构建时做静态替换。
// 用 try/catch 是为了让 Node / esbuild 下的 selftest（那里没有 import.meta.env）
// 安静地落回本机模式，而不是在模块加载时抛错。
try {
  const value = import.meta.env.VITE_SUPABASE_URL
  if (typeof value === 'string') envUrl = value.trim()
} catch {
  envUrl = ''
}
try {
  const value = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (typeof value === 'string') envAnonKey = value.trim()
} catch {
  envAnonKey = ''
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/** Supabase 项目地址；空字符串 = 未配置。环境变量优先，其次文件内常量。 */
export const SUPABASE_URL = trimTrailingSlash((envUrl || HARDCODED_SUPABASE_URL).trim())

/** Supabase anon public key；空字符串 = 未配置。公开密钥，不是 service_role。 */
export const SUPABASE_ANON_KEY = (envAnonKey || HARDCODED_SUPABASE_ANON_KEY).trim()

/** 两项都配置好才启用远程模式；否则使用本机模式 */
export const REQUESTS_REMOTE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
