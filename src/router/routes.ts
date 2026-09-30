import type { RouteRecordRaw } from 'vue-router'
import Home from '../views/Home.vue'
import Layout from '../layouts/Layout.vue'

/** 扩展路由元信息类型，让 route.meta.title 具备 string 类型而不是 unknown */
declare module 'vue-router' {
  interface RouteMeta {
    /** 浏览器标签页标题 */
    title?: string
    /**
     * 该路由挂载哪一套外壳。
     * 仅用于测试 / 调试断言（SSR 冒烟据此选择外壳标记），运行时逻辑不读它 ——
     * 外壳由路由表的嵌套结构决定，而不是由 meta 判断。
     */
    layout?: 'public' | 'admin'
    /**
     * 是否需要登录（Phase 15）。
     *
     * 默认**由 /admin 父记录下发为 true**，只有登录页显式写成 false。
     * 这样「新加一个后台路由忘了加保护」不会发生 —— 安全默认值优于少写一行。
     */
    requiresAuth?: boolean
  }
}

/**
 * 路由表
 *
 * 与 router 实例分离，便于在 SSR 冒烟测试中用 memory history 复用同一份路由配置。
 *
 * 【Phase 1 结构】改为「双 Layout 嵌套路由」：
 *   - `/`      → Layout.vue      （公开站骨架）
 *   - `/admin` → AdminLayout.vue （后台骨架）
 * 两套外壳完全分离，后台不再继承公开站 Header / Footer。
 *
 * 首屏之外的视图一律懒加载，避免把后台 / 调试台 / 样式验收页打进主包。
 */
export const routes: RouteRecordRaw[] = [
  /* ========================= 公开站 ========================= */
  {
    path: '/',
    component: Layout,
    meta: { layout: 'public' },
    children: [
      {
        path: '',
        name: 'home',
        component: Home,
        meta: { title: '首页' },
      },
      {
        path: 'game/:id',
        name: 'game',
        component: () => import('../views/GameDetail.vue'),
        props: true,
        meta: { title: '游戏详情' },
      },
      {
        path: 'debug',
        name: 'debug',
        component: () => import('../views/DebugLibrary.vue'),
        meta: { title: '调试台' },
      },
      {
        path: 'style',
        name: 'style',
        component: () => import('../views/StyleSpecimen.vue'),
        meta: { title: '样式规范' },
      },
      {
        // 公开站 404 兜底。位于子路由末尾，优先级最低，不会抢走 /admin/** 的匹配。
        path: ':pathMatch(.*)*',
        name: 'not-found',
        component: () => import('../views/NotFound.vue'),
        meta: { title: '页面不存在' },
      },
    ],
  },

  /* ========================= 后台 ========================= */
  {
    path: '/admin',
    component: () => import('../layouts/AdminLayout.vue'),
    // ⚠️ 认证要求写在**父记录**上：子路由的 meta 会覆盖父记录，
    //    所以新增后台页面默认就是受保护的，不必逐个记得加。
    //    只有下面的登录页显式豁免。
    meta: { layout: 'admin', requiresAuth: true },
    children: [
      {
        path: '',
        name: 'admin-root',
        redirect: { name: 'admin-games' },
      },
      {
        // 登录页是唯一豁免认证的后台路由 —— 否则「要登录才能看登录页」
        path: 'login',
        name: 'admin-login',
        component: () => import('../views/admin/AdminLogin.vue'),
        meta: { title: '管理登录', requiresAuth: false },
      },
      {
        path: 'games',
        name: 'admin-games',
        component: () => import('../views/admin/AdminGames.vue'),
        meta: { title: '游戏管理' },
      },
      {
        // 新增模式：不传 id，组件据此判定 isNew
        path: 'games/new',
        name: 'admin-game-new',
        component: () => import('../views/admin/AdminGameEditor.vue'),
        meta: { title: '新增游戏' },
      },
      {
        // 编辑模式：props: true 把 id 注入组件
        path: 'games/:id/edit',
        name: 'admin-game-edit',
        component: () => import('../views/admin/AdminGameEditor.vue'),
        props: true,
        meta: { title: '编辑游戏' },
      },
      {
        // 预览编辑中的内容。⚠️ 挂在 /admin 下 —— 它显示的是**未发布**内容，
        //    必须自动受登录门禁保护（requiresAuth 由父记录下发）。
        path: 'preview',
        name: 'admin-preview',
        component: () => import('../views/admin/AdminGamePreview.vue'),
        meta: { title: '预览' },
      },
      {
        path: 'tags',
        name: 'admin-tags',
        component: () => import('../views/admin/AdminTags.vue'),
        meta: { title: '标签管理' },
      },
      {
        // 后台 404：静态前缀 /admin 使其优先级高于公开站的 catch-all，
        // 保证输错的后台地址仍渲染在后台骨架内，而不是掉回公开站外壳。
        path: ':pathMatch(.*)*',
        name: 'admin-not-found',
        component: () => import('../views/admin/AdminNotFound.vue'),
        meta: { title: '后台页面不存在' },
      },
    ],
  },
]
