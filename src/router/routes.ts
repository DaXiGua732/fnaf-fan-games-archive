import type { RouteRecordRaw } from 'vue-router'
import Home from '../views/Home.vue'

/** 扩展路由元信息类型，让 route.meta.title 具备 string 类型而不是 unknown */
declare module 'vue-router' {
  interface RouteMeta {
    /** 浏览器标签页标题 */
    title?: string
  }
}

/**
 * 路由表
 *
 * 与 router 实例分离，便于在 SSR 冒烟测试中用 memory history 复用同一份路由配置。
 *
 * 首屏之外的视图一律懒加载，避免把调试台 / 样式验收页打进主包。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: Home,
    meta: { title: '首页' },
  },
  {
    path: '/game/:id',
    name: 'game',
    component: () => import('../views/GameDetail.vue'),
    props: true,
    meta: { title: '游戏详情' },
  },
  {
    path: '/debug',
    name: 'debug',
    component: () => import('../views/DebugLibrary.vue'),
    meta: { title: '调试台' },
  },
  {
    path: '/style',
    name: 'style',
    component: () => import('../views/StyleSpecimen.vue'),
    meta: { title: '样式规范' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/NotFound.vue'),
    meta: { title: '页面不存在' },
  },
]
