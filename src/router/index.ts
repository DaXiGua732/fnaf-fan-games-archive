import { createRouter, createWebHashHistory } from 'vue-router'
import { installAuthGuard } from './authGuard'
import { routes } from './routes'

export { routes }

const SITE_NAME = 'FNAF FAN GAMES ARCHIVE'

/**
 * 使用 createWebHashHistory：GitHub Pages 是纯静态托管，没有服务端 rewrite，
 * History 模式在刷新子路径时必然 404。Hash 模式（/#/game/xxx）是唯一稳妥解。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    // 只有 query 变化（首页筛选用 replace 同步 URL）时保持当前位置，
    // 否则每敲一个字都会被拉回页面顶部。
    if (to.path === from.path && to.hash === from.hash) return false
    return { top: 0 }
  },
})

installAuthGuard(router)

router.afterEach((to) => {
  // 守卫：SSR / 非浏览器环境（如冒烟测试）下没有 document
  if (typeof document === 'undefined') return
  const pageTitle = to.meta.title
  document.title = pageTitle ? `${pageTitle} · ${SITE_NAME}` : SITE_NAME
})

export default router
