import { createRouter, createWebHashHistory } from 'vue-router'
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
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
})

router.afterEach((to) => {
  // 守卫：SSR / 非浏览器环境（如冒烟测试）下没有 document
  if (typeof document === 'undefined') return
  const pageTitle = to.meta.title
  document.title = pageTitle ? `${pageTitle} · ${SITE_NAME}` : SITE_NAME
})

export default router
