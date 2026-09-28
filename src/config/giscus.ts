/**
 * ============================================================================
 * Giscus 评论配置
 * ============================================================================
 * 启用步骤（全部在 GitHub 网页上完成，约 5 分钟）：
 *
 *   1. 建一个【公开】仓库，例如 `your-name/fnaf-archive-comments`
 *      （专门放评论，与站点代码仓库分开更干净）
 *   2. 仓库 → Settings → General → Features → 勾选 **Discussions**
 *   3. 进入 Discussions 标签页，新建一个分类，名称填 `Announcements`，
 *      类型选 **Announcements**（只有维护者能发起讨论，防止刷屏）
 *   4. 安装 giscus App 并授权该仓库：https://github.com/apps/giscus
 *   5. 打开 https://giscus.app/zh-CN ，填入 `your-name/fnaf-archive-comments`，
 *      页面会实时生成 **repoId** 与 **categoryId**（形如 R_kgDO… / DIC_kwDO…）
 *   6. 把下面 4 个参数填上，并把 enabled 改成 true
 *
 * ⚠️ 关于 mapping 的重要提醒：
 *   本站使用 **Hash 路由**（/#/game/xxx），window.location.pathname 永远是 `/`。
 *   如果 mapping 用 'pathname'，**所有游戏的评论会被合并到同一个讨论串**。
 *   因此这里固定用 'specific' + data-term = game.id，保证一游戏一讨论串。
 * ============================================================================
 */

export interface GiscusConfig {
  enabled: boolean
  /** 形如 'your-name/fnaf-archive-comments' */
  repo: string
  /** 形如 'R_kgDOxxxxxxx' */
  repoId: string
  /** 讨论分类名，如 'Announcements' */
  category: string
  /** 形如 'DIC_kwDOxxxxxxxx' */
  categoryId: string
  /** Hash 路由下必须用 specific，绝不能改成 pathname */
  mapping: 'specific' | 'pathname' | 'url' | 'title' | 'og:title'
  reactionsEnabled: boolean
  inputPosition: 'top' | 'bottom'
  lang: string
  loading: 'lazy' | 'eager'
}

export const GISCUS_CONFIG: GiscusConfig = {
  enabled: false,
  repo: '',
  repoId: '',
  category: '',
  categoryId: '',
  mapping: 'specific',
  reactionsEnabled: true,
  inputPosition: 'top',
  lang: 'zh-CN',
  loading: 'lazy',
}

export function isGiscusConfigured(): boolean {
  const c = GISCUS_CONFIG
  return (
    c.enabled &&
    c.repo.trim() !== '' &&
    c.repoId.trim() !== '' &&
    c.category.trim() !== '' &&
    c.categoryId.trim() !== ''
  )
}

/**
 * 自定义主题 CSS 的绝对地址。
 * 必须用绝对 URL：giscus 是在 giscus.app 的 iframe 内加载这个样式表的。
 * import.meta.env.BASE_URL 保证 GitHub Pages 子路径部署时也能取到正确路径。
 */
export function giscusThemeUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${import.meta.env.BASE_URL}giscus-swiss.css`
}

export const GISCUS_SCRIPT_SRC = 'https://giscus.app/client.js'
