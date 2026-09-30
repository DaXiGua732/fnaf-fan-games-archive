/**
 * ============================================================================
 * useGamePreview —— 编辑页的「预览」
 * ============================================================================
 * 目标：**用真实的前台详情页组件**，渲染编辑页里**当前（未保存）的内容**。
 *
 * ---------------------------------------------------------------------------
 * 【为什么是「新标签页 + sessionStorage」】
 * 预览必须用真的 `GameDetail`（而不是另写一个"像前台"的预览页 —— 那迟早会分叉）。
 * 但 `GameDetail` 是个路由组件，要渲染它就得导航过去，而导航会**卸载编辑页** ——
 * 编辑器的草稿是**每个编辑会话一份**的，卸载即丢弃，
 * 于是「看一眼预览，没保存的改动全没了」。
 *
 * 这个项目里连「未保存改动」的离开拦截都是为这件事存在的，
 * 所以绝不能为了预览把它绕过去。解法：
 *
 *   编辑页 → 把草稿写进 localStorage（**同源标签页之间可靠共享**）
 *          → window.open 一个新标签页打开 /#/admin/preview
 *
 * 编辑页毫发无损，预览页读到的是刚才那份草稿。
 *
 * ⚠️ 预览路由必须挂在 `/admin` 下 —— 它显示的是**未发布**的内容，
 *    绝不能被一个公开地址渲染出来。
 * ============================================================================
 */
import type { InjectionKey, Ref } from 'vue'
import type { AdminGame } from '../types/admin'

/**
 * 用 **localStorage** 存预览内容。
 *
 * ⚠️ 一开始用的是 sessionStorage —— 实测发现它**不会**跟着 `window.open`
 * 的新标签页走（Playwright 与真实浏览器都是），预览页拿到的是 null。
 * localStorage 是同源标签页之间唯一可靠共享的 storage。
 *
 * 代价：预览内容会留在本机浏览器里 —— 所以 `readPreview()` 是**一次性**的，
 * 读完立刻清掉（见下）。反正预览本来就是一次性的东西。
 */

/**
 * 注入键：预览路由把「要预览的那条作品」提供给真实的 `GameDetail`。
 * `GameDetail` 只在拿到它时才走预览分支，平时完全不受影响。
 */
export const PREVIEW_GAME_KEY: InjectionKey<Ref<AdminGame | null>> = Symbol('preview-game')

/** localStorage 里放预览内容的键名。带版本号，将来换方案改 v2 即可 */
const PREVIEW_KEY = 'fnaf-archive:preview:v1'

/** 预览页的地址。挂在后台路由下，因此自动受登录门禁保护 */
export const PREVIEW_PATH = '/admin/preview'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式下访问 localStorage 会抛错 —— 当作没有
    return null
  }
}

/**
 * 把草稿写进 sessionStorage，供新标签页里的预览读取。
 * 写不进去也不报错：预览页会显示「没有可预览的内容」，而不是崩掉。
 */
export function publishPreview(game: AdminGame): void {
  try {
    storage()?.setItem(PREVIEW_KEY, JSON.stringify(game))
  } catch {
    // 配额满 / 隐私模式：预览会显示空状态，不影响编辑本身
  }
}

/**
 * 读取预览内容，**读完立刻清掉** —— 这是一次性交接，不是持久数据。
 *
 * 读不到（或内容损坏）时返回 null，预览页会显示空状态而不是崩掉。
 */
export function readPreview(): AdminGame | null {
  try {
    const store = storage()
    const raw = store?.getItem(PREVIEW_KEY)
    if (store) store.removeItem(PREVIEW_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as AdminGame) : null
  } catch {
    return null
  }
}
