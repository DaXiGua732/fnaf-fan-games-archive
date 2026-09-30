/**
 * 登录门禁（Phase 15）
 *
 * 【为什么单独一个文件】
 * 它必须能被 SSR 冒烟测试复用 —— 冒烟要装**同一套**守卫，
 * 否则后台用例会因为「测试自己建了个不带守卫的 router」而把受保护的页面渲染出来，
 * 门禁等于从来没被测过。
 *
 * 而 `router/index.ts` 会**创建带 hash history 的真实 router**（Node 里没有 `location`），
 * 所以不能从那里导出。这与 `routes.ts` 与 router 实例分离是同一个理由。
 */
import type { Router } from 'vue-router'

/**
 * 给一个 router 装上登录门禁。
 *
 * ⚠️ 判据只是「本机有没有令牌」，**不在这里每次都去校验令牌是否有效** ——
 * 那会让每次路由跳转都多一次网络往返。令牌失效会在真正读写数据时暴露，
 * 那时的错误信息是明确的（见 useAdminAuth / githubApi 的错误翻译）。
 */
export function installAuthGuard(router: Router): void {
  router.beforeEach(async (to) => {
    if (!to.meta.requiresAuth) return true

    // ⚠️ **动态** import：认证模块只在真的要进后台时才加载。
    //    写成静态 import 的话，它会连同 GitHub 客户端一起被打进主包 ——
    //    而公开站的访客永远用不到那几 KB。
    //    （与「首屏之外的视图一律懒加载」是同一条原则。）
    const { useAdminAuth } = await import('../composables/useAdminAuth')
    if (useAdminAuth().isAuthenticated.value) return true

    return {
      name: 'admin-login',
      // 登录后回到原来想去的地方
      query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : {},
    }
  })
}
