/**
 * ============================================================================
 * 浏览量服务 —— 适配器模式
 * ============================================================================
 * 当前状态：**静态基数模式**（尚未接入任何后端）。
 *   - `trackView()` 直接返回 db.json 里的 `metrics.fakeViews`，不发任何网络请求。
 *   - 因此页面永远不会因为统计服务故障而变慢或报错。
 *
 * 接入真实后端时，只需两步，不用改动任何组件：
 *   1. 实现下面的 ViewProvider 接口（示例见文件末尾注释）
 *   2. 在 main.ts 里调用 registerViewProvider(yourProvider)
 *
 * 期望的后端表结构（极简）：
 *   views: { game_id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0 }
 * ============================================================================
 */

export interface ViewProvider {
  /** 唯一标识，用于 UI 上标注数据来源 */
  id: string
  /** 读取当前浏览量；返回 null 表示该 gameId 尚无记录 */
  read: (gameId: string) => Promise<number | null>
  /** 自增一次并返回新值；返回 null 表示写入失败 */
  increment: (gameId: string) => Promise<number | null>
}

export interface ViewResult {
  count: number
  /** remote = 来自后端；static = 来自 db.json 的静态基数 */
  source: 'remote' | 'static'
}

let activeProvider: ViewProvider | null = null

export function registerViewProvider(provider: ViewProvider | null): void {
  activeProvider = provider
}

export function getActiveProviderId(): string {
  return activeProvider ? activeProvider.id : 'static'
}

export function isRemoteViewEnabled(): boolean {
  return activeProvider !== null
}

/**
 * 记录一次浏览：自增 + 读取。
 * 任何异常都会静默降级到静态基数 —— 统计失败绝不能影响页面可用性。
 */
export async function trackView(gameId: string, staticBase: number): Promise<ViewResult> {
  if (activeProvider === null) {
    return { count: staticBase, source: 'static' }
  }

  try {
    const incremented = await activeProvider.increment(gameId)
    if (incremented !== null) {
      return { count: incremented, source: 'remote' }
    }
    const current = await activeProvider.read(gameId)
    if (current !== null) {
      return { count: current, source: 'remote' }
    }
  } catch {
    // 后端不可用 / 网络异常 / 权限不足：静默降级
  }

  return { count: staticBase, source: 'static' }
}

/* ---------------------------------------------------------------------------
   参考实现（接入 Supabase 时照此填写，然后删掉注释即可）

   import { createClient } from '@supabase/supabase-js'

   const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

   const supabaseViewProvider: ViewProvider = {
     id: 'supabase',
     async read(gameId) {
       const { data } = await supabase
         .from('views')
         .select('count')
         .eq('game_id', gameId)
         .maybeSingle()
       return data ? Number(data.count) : null
     },
     async increment(gameId) {
       // 依赖数据库端的 rpc（见下方 SQL），避免前端「读-改-写」竞态
       const { data, error } = await supabase
         .rpc('increment_view', { p_game_id: gameId })
       if (error) return null
       return typeof data === 'number' ? data : null
     },
   }

   -- 配套 SQL：
   -- create table if not exists public.views (
   --   game_id text primary key,
   --   count   integer not null default 0
   -- );
   -- create or replace function public.increment_view(p_game_id text)
   -- returns integer language plpgsql security definer as $$
   -- declare new_count integer;
   -- begin
   --   insert into public.views (game_id, count) values (p_game_id, 1)
   --   on conflict (game_id) do update set count = public.views.count + 1
   --   returning count into new_count;
   --   return new_count;
   -- end; $$;
   --------------------------------------------------------------------------- */
