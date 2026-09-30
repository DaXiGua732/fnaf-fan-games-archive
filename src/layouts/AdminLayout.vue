<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router'
import AdminNav from '../components/admin/AdminNav.vue'
import StyleAuditBadge from '../components/StyleAuditBadge.vue'
import { useAdminAuth } from '../composables/useAdminAuth'

/**
 * AdminLayout —— 后台骨架
 *
 * 与公开站 Layout.vue **完全分离**：这里没有公开站的 Header、Footer、
 * 站内导航与免责声明。两条外壳各自独立，互不污染。
 *
 * 结构：
 *   [ 后台 Header ]   FNAF / ADMIN              已登录 · 登出 · 返回站点 →
 *   ┌──────────────┬──────────────────────────────────────────┐
 *   │ AdminNav     │  <RouterView />（后台内容出口）            │
 *   └──────────────┴──────────────────────────────────────────┘
 *
 * Swiss 约束复查点：
 *  - 全部用 1px 边框分隔（主分隔 border-black / 次分隔 #cccccc），零阴影、零圆角、零渐变
 *  - 悬停只改文字颜色为 #ff0000，过渡上限 duration-150
 *  - 布局用 grid / flex 而非 position:fixed，避免移动端遮挡与滚动耦合
 *  - 只有表格数字列允许右对齐（本文件内无表格）
 */

/** 视觉规范运行期哨兵只在开发期挂载；生产构建下整块被剔除 */
const isDev = import.meta.env.DEV

const router = useRouter()
const { isAuthenticated, account, logout } = useAdminAuth()

/** 登出后回登录页 —— 停留在需要登录的页面上会立刻被守卫弹走，多一次闪烁 */
async function onLogout(): Promise<void> {
  logout()
  await router.replace({ name: 'admin-login' })
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-white text-black">
    <a
      href="#admin-main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-[60] focus:border focus:border-black focus:bg-white focus:px-4 focus:py-2 focus:font-sans focus:text-xs focus:font-bold"
    >
      跳到后台主内容
    </a>

    <!-- ============ 后台 Header ============ -->
    <header class="sticky top-0 z-50 border-b border-black bg-white">
      <div class="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-6 py-4 md:px-12">
        <RouterLink
          to="/admin/games"
          class="flex items-baseline font-sans text-sm font-bold uppercase tracking-[0.24em] transition-colors duration-150 ease-out hover:text-[#ff0000]"
        >
          <span>FNAF</span>
          <span class="px-1 text-[#ff0000]">/</span>
          <span>Admin</span>
        </RouterLink>

        <div class="flex items-center gap-6">
          <!-- 认证状态（Phase 15）：未登录时明确说清，登录后显示账号与登出 -->
          <template v-if="isAuthenticated">
            <p class="swiss-meta hidden text-black/45 sm:block">
              已登录{{ account ? ` · ${account}` : '' }}
            </p>
            <button
              type="button"
              class="font-sans text-xs font-bold uppercase tracking-[0.16em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]"
              @click="onLogout"
            >
              登出
            </button>
          </template>
          <RouterLink
            v-else
            :to="{ name: 'admin-login' }"
            class="font-sans text-xs font-bold uppercase tracking-[0.16em] text-[#ff0000] transition-colors duration-150 ease-out hover:text-black"
          >
            登录
          </RouterLink>

          <RouterLink
            to="/"
            class="group inline-flex items-baseline gap-3 border-b-2 border-b-transparent py-1 font-sans text-xs font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:border-b-[#ff0000] hover:text-[#ff0000]"
          >
            <span>返回站点</span>
            <span class="u-arrow" aria-hidden="true">&#8594;</span>
          </RouterLink>
        </div>
      </div>
    </header>

    <!-- ============ 侧栏 + 内容 ============ -->
    <div class="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-6 md:flex-row md:px-12">
      <AdminNav />

      <main id="admin-main" class="min-w-0 flex-1 md:pl-10">
        <RouterView />

        <!-- 开发期视觉规范哨兵：全量扫描后台 DOM 的圆角 / 阴影 -->
        <div v-if="isDev" class="mt-16 border-t border-[#cccccc] pt-8">
          <StyleAuditBadge />
        </div>
      </main>
    </div>
  </div>
</template>
