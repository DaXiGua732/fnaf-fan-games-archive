<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

/**
 * Layout —— 全局骨架
 * 结构：Header（白底黑字黑边框）→ main（路由出口）→ Footer（黑底白字）
 *
 * Swiss 约束复查点：
 *  - Header 用 1px 黑色下边框与内容分离，禁止用阴影
 *  - 导航悬停只改变文字颜色为 #ff0000，过渡 150ms
 *  - 激活态用红色文字 + 2px 红色下边框（始终占位，避免布局抖动）
 */

interface NavItem {
  to: string
  label: string
  /** 是否精确匹配（'/' 必须精确，否则任何路由都会点亮首页） */
  exact: boolean
  /** 开发期入口，正式上线前移除 */
  dev?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '首页', exact: true },
  { to: '/debug', label: '调试台', exact: false, dev: true },
  { to: '/style', label: '样式规范', exact: false, dev: true },
]

const route = useRoute()
const menuOpen = ref(false)

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false
  },
)

function linkClass(isActive: boolean): string {
  return [
    'block border-b-2 py-1 font-sans text-xs font-bold uppercase tracking-[0.16em] transition-colors duration-150',
    isActive
      ? 'border-b-[#ff0000] text-[#ff0000]'
      : 'border-b-transparent text-black hover:text-[#ff0000]',
  ].join(' ')
}

const currentYear = new Date().getFullYear()
</script>

<template>
  <div class="flex min-h-screen flex-col bg-white text-black">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-[60] focus:border focus:border-black focus:bg-white focus:px-4 focus:py-2 focus:font-sans focus:text-xs focus:font-bold"
    >
      跳到主内容
    </a>

    <!-- ============ Header ============ -->
    <header class="sticky top-0 z-50 border-b border-black bg-white">
      <div class="mx-auto flex max-w-[1280px] items-center justify-between gap-6 px-6 py-4 md:px-12">
        <!-- Logo -->
        <RouterLink
          to="/"
          class="flex items-baseline gap-0 font-sans text-sm font-bold uppercase tracking-[0.24em] transition-colors duration-150 hover:text-[#ff0000]"
        >
          <span>FNAF</span>
          <span class="px-1 text-[#ff0000]">/</span>
          <span>Archive</span>
        </RouterLink>

        <!-- 桌面菜单 -->
        <nav class="hidden items-center gap-8 md:flex" aria-label="主导航">
          <RouterLink
            v-for="item in NAV_ITEMS"
            :key="item.to"
            v-slot="{ href, navigate, isActive, isExactActive }"
            :to="item.to"
            custom
          >
            <a :href="href" :class="linkClass(item.exact ? isExactActive : isActive)" @click="navigate">
              {{ item.label }}
              <sup v-if="item.dev" class="ml-1 font-sans text-[8px] tracking-normal text-black/35">DEV</sup>
            </a>
          </RouterLink>
        </nav>

        <!-- 移动端开关 -->
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center border border-black font-sans text-sm font-bold transition-colors duration-150 hover:bg-black hover:text-white md:hidden"
          :aria-expanded="menuOpen"
          aria-controls="mobile-nav"
          aria-label="切换菜单"
          @click="menuOpen = !menuOpen"
        >
          {{ menuOpen ? '×' : '≡' }}
        </button>
      </div>

      <!-- 移动端菜单 -->
      <nav
        v-show="menuOpen"
        id="mobile-nav"
        class="border-t border-[#cccccc] bg-white md:hidden"
        aria-label="移动端导航"
      >
        <div class="mx-auto flex max-w-[1280px] flex-col gap-4 px-6 py-6">
          <RouterLink
            v-for="item in NAV_ITEMS"
            :key="item.to"
            v-slot="{ href, navigate, isActive, isExactActive }"
            :to="item.to"
            custom
          >
            <a :href="href" :class="linkClass(item.exact ? isExactActive : isActive)" @click="navigate">
              {{ item.label }}
              <sup v-if="item.dev" class="ml-1 font-sans text-[8px] tracking-normal text-black/35">DEV</sup>
            </a>
          </RouterLink>
        </div>
      </nav>
    </header>

    <!-- ============ 主体 ============ -->
    <main id="main" class="flex-1">
      <slot />
    </main>

    <!-- ============ Footer ============ -->
    <footer class="bg-black text-white">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-20">
        <div class="grid gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div>
            <p class="font-sans text-sm font-bold uppercase tracking-[0.24em]">
              FNAF FAN GAMES ARCHIVE
            </p>
            <p class="mt-6 max-w-[62ch] font-sans text-xs leading-relaxed text-white/70">
              本站为非商业性质的粉丝向资源导航站。站内收录的所有游戏作品，其著作权均归各自原作者所有；
              所有下载链接均指向第三方网盘，本站不存储、不托管、不分发任何游戏文件本体。
              若权利人认为站内信息侵犯其合法权益，请通过下方邮箱联系，我们将在核实后第一时间移除。
            </p>
            <p class="mt-6 max-w-[62ch] font-sans text-xs leading-relaxed text-white/70">
              本站与 Scott Cawthon、Steel Wool Studios 及 Five Nights at Freddy's 官方无任何关联，
              亦未获得其授权或认可。
            </p>
            <p class="swiss-meta mt-8 text-white/50">
              CONTACT — fnaf-archive@example.com
            </p>
          </div>

          <div class="lg:justify-self-end">
            <p class="swiss-meta mb-5 text-white/50">站点导航</p>
            <ul class="space-y-3">
              <li v-for="item in NAV_ITEMS" :key="item.to">
                <RouterLink
                  :to="item.to"
                  class="font-sans text-xs font-bold uppercase tracking-[0.16em] text-white/80 transition-colors duration-150 hover:text-[#ff0000]"
                >
                  {{ item.label }}
                </RouterLink>
              </li>
              <li>
                <a
                  href="#main"
                  class="font-sans text-xs font-bold uppercase tracking-[0.16em] text-white/80 transition-colors duration-150 hover:text-[#ff0000]"
                >
                  回到顶部
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div class="mt-16 border-t border-white/20 pt-6">
          <p class="swiss-meta text-white/50">
            © {{ currentYear }} FNAF Fan Games Archive · Swiss International Style · Built as a static site
          </p>
        </div>
      </div>
    </footer>
  </div>
</template>
