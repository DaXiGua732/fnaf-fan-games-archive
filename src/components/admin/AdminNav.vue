<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useAdminAuth } from '../../composables/useAdminAuth'

/**
 * AdminNav —— 后台分区导航
 *
 * 桌面端（md+）：纵向列表，位于内容区左侧。
 * 移动端：横向可滚动条，位于内容区上方。
 *
 * 未实现的模块（ready=false）渲染为**不可点击的禁用态 + PLANNED 角标**，
 * 而不是隐藏 —— 让「这个后台将来长什么样」从一开始就可见。
 *
 * 【Phase 15】未登录时不渲染分区链接：那些链接全都会把用户弹回登录页，
 * 点一次等于白跳一次。改为一句说明，把注意力留给登录。
 *
 * Swiss 约束复查点：
 *  - 激活态用「常驻 2px 透明左边框 → 激活变红」，与公开站导航同款抖动规避手法
 *  - 只有 1px 边框与留白做层级，无底色块、无阴影、无圆角
 */
interface AdminNavItem {
  to: string
  label: string
  /** 该模块是否已实现 */
  ready: boolean
}

const { isAuthenticated } = useAdminAuth()

const NAV_ITEMS: AdminNavItem[] = [
  { to: '/admin/games', label: '游戏管理', ready: true },
  // 标签与作者合并在同一页：它们都是作品的派生分类维度，没必要占两个导航项。
  { to: '/admin/taxonomy', label: '标签与作者', ready: true },
  // 受控词表：玩法类型 / 机制 / 平台。标签与作者仍是派生字符串，两者不要混。
  { to: '/admin/vocabulary', label: '玩法与机制', ready: true },
  { to: '/admin/settings', label: '系统设置', ready: false },
]

const ITEM_BASE =
  'block shrink-0 border-l-2 py-3 pl-4 pr-8 font-sans text-[11px] font-bold uppercase ' +
  'tracking-[0.16em] transition-colors duration-150 ease-out'

function itemClass(ready: boolean, active: boolean): string {
  if (!ready) {
    return [ITEM_BASE, 'border-l-transparent text-black/25'].join(' ')
  }
  return [
    ITEM_BASE,
    active
      ? 'border-l-accent text-accent'
      : 'border-l-transparent text-black hover:text-accent',
  ].join(' ')
}
</script>

<template>
  <nav
    class="shrink-0 border-b border-line md:w-[220px] md:border-b-0 md:border-r md:border-line md:pr-6"
    aria-label="后台分区导航"
  >
    <p class="swiss-meta hidden pb-3 pt-1 text-black/45 md:block">Sections</p>

    <ul v-if="isAuthenticated" class="flex overflow-x-auto md:flex-col md:overflow-visible">
      <li v-for="item in NAV_ITEMS" :key="item.to" class="shrink-0 md:shrink">
        <template v-if="item.ready">
          <RouterLink v-slot="{ href, navigate, isActive }" :to="item.to" custom>
            <a :href="href" :class="itemClass(true, isActive)" @click="navigate">
              {{ item.label }}
            </a>
          </RouterLink>
        </template>

        <span v-else :class="itemClass(false, false)" aria-disabled="true">
          {{ item.label }}
          <sup class="ml-2 font-sans text-[8px] tracking-normal text-black/35">PLANNED</sup>
        </span>
      </li>
    </ul>

    <p v-else class="max-w-[34ch] font-sans text-xs leading-relaxed text-black/45">
      登录后这里会列出各个分区。
    </p>
  </nav>
</template>
