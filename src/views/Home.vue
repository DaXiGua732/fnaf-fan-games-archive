<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FilterPanel from '../components/FilterPanel.vue'
import GameCard from '../components/GameCard.vue'
import ResourceRequestBoard from '../components/ResourceRequestBoard.vue'
import ResourceRequestDialog from '../components/ResourceRequestDialog.vue'
import { useGameLibrary } from '../composables/useGameLibrary'

const route = useRoute()
const router = useRouter()
/* 首页：探索与筛选。所有数据加工都在深模块内，本页只负责渲染。 */
const {
  catalogSize,
  totalSize,
  games,
  isLoading,
  total,
  currentPage,
  totalPages,
  hasActiveFilters,
  availableAuthors,
  availableYears,
  clearFilters,
  setPage,
  refreshCatalog,
  activeFilters,
  activeFilterChips,
  invalidFilterChips,
  clearInvalidFilters,
  removeFilterValue,
  hydrateFromQuery,
  toQueryParams,
  querySignature,
} = useGameLibrary()

/*
 * URL ↔ 查询状态（Phase 3）
 *
 * 两个方向都要做，但**只在签名不同时**动作：
 *   - 用户改筛选 → 状态先变 → 这里把状态写进 URL（页面内用 replace，不刷历史）；
 *   - 刷新 / 复制链接 / 前进后退 → route.query 变 → 这里把 URL 覆盖回状态。
 * 如果没有这层签名比较，两边会互相触发，形成无限循环。
 */
hydrateFromQuery(route.query)

watch(
  () => route.query,
  (next) => {
    if (querySignature(next) === querySignature(toQueryParams())) return
    hydrateFromQuery(next)
  },
)

watch([activeFilters, currentPage], () => {
  const next = toQueryParams()
  if (querySignature(next) === querySignature(route.query)) return
  void router.replace({ name: 'home', query: next })
})

/** Hash 路由下不能用 href="#library"：那会被当成路由跳转 */
function scrollToLibrary(): void {
  if (typeof document === 'undefined') return
  document.getElementById('library')?.scrollIntoView({ block: 'start' })
}

/** 催资源弹窗 —— 只控制开合，请求状态在 useResourceRequests 单例里 */
const requestDialogOpen = ref(false)

function openRequestDialog(): void {
  requestDialogOpen.value = true
}

function closeRequestDialog(): void {
  requestDialogOpen.value = false
}

// 每次回到公开首页都与数据仓对一次账：后台刚改完状态 / 删了作品，
// 这里不需要等下一次构建就能看到（生产构建才真正发请求）。
function refreshWhenVisible(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    void refreshCatalog()
  }
}

onMounted(() => {
  void refreshCatalog()
  document.addEventListener('visibilitychange', refreshWhenVisible)

  // 从详情页的索引入口进来（或带条件刷新）时，直接落在结果区，
  // 不让用户自己再滚一遍。页面内的筛选变化不会触发这里。
  if (Object.keys(route.query).length > 0) {
    void nextTick(scrollToLibrary)
  }
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', refreshWhenVisible)
})

/** 年份跨度，如 2015–2019（availableYears 已按降序排列） */
const yearRange = computed(() => {
  const years = availableYears.value
  if (years.length === 0) return '—'
  if (years.length === 1) return String(years[0])
  return `${years[years.length - 1]}–${years[0]}`
})

const SKELETON_KEYS = [1, 2, 3, 4, 5, 6]
</script>

<template>
  <div>
    <!-- ============ Hero ============ -->
    <section class="bg-accent-surface text-on-accent">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12 md:py-32">
        <p class="swiss-meta mb-8">Five Nights at Freddy's — Fan Game Repository</p>
        <h1
          class="font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-7xl"
        >
          FNAF Fan Games<br />Archive
        </h1>
        <p class="mt-10 max-w-[56ch] font-sans text-base leading-relaxed text-on-accent/90">
          收录 Five Nights at Freddy's 系列同人游戏。按年份、作者、IP 系列交叉检索，
          一键跳转第三方网盘下载。
        </p>

        <div class="mt-10">
          <button
            type="button"
            class="group inline-flex items-center gap-4 border border-on-accent bg-on-accent px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-accent-surface transition-colors duration-150 ease-out hover:bg-transparent hover:text-on-accent"
            @click="openRequestDialog"
          >
            <span>催一个资源</span>
            <span class="u-arrow" aria-hidden="true">&#8594;</span>
          </button>
        </div>

        <dl
          class="mt-16 grid max-w-[760px] grid-cols-2 gap-8 border-t border-on-accent/30 pt-8 sm:grid-cols-3"
        >
          <div>
            <dt class="swiss-meta text-on-accent/70">收录作品</dt>
            <dd class="mt-2 font-sans text-3xl font-bold leading-none">{{ totalSize }}</dd>
            <p
              v-if="totalSize !== catalogSize"
              class="mt-2 font-sans text-[11px] leading-relaxed text-on-accent/60"
            >
              其中 {{ catalogSize }} 款当前可浏览
            </p>
          </div>
          <div>
            <dt class="swiss-meta text-on-accent/70">创作者</dt>
            <dd class="mt-2 font-sans text-3xl font-bold leading-none">
              {{ availableAuthors.length }}
            </dd>
          </div>
          <div>
            <dt class="swiss-meta text-on-accent/70">年份跨度</dt>
            <dd class="mt-2 font-sans text-3xl font-bold leading-none">{{ yearRange }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- ============ 催资源 ============ -->
    <ResourceRequestBoard @request="openRequestDialog" />

    <!-- ============ 探索与筛选 ============ -->
    <section id="library" class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-24">
        <p class="swiss-meta mb-8">02 — Explore &amp; Filter</p>

        <FilterPanel />

        <!-- 索引入口带来的条件：只显示维度条件（搜索词由上面的输入框表达） -->
        <div
          v-if="activeFilterChips.length"
          class="mt-8 border border-black px-6 py-5"
          aria-live="polite"
        >
          <div class="flex flex-wrap items-center justify-between gap-4">
            <p class="swiss-meta text-black/60">当前索引条件</p>
            <div class="flex flex-wrap items-center gap-6">
              <button
                v-if="invalidFilterChips.length"
                type="button"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-accent transition-colors duration-150 ease-out hover:text-black"
                @click="clearInvalidFilters"
              >
                清除失效条件
              </button>
              <button
                type="button"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-black/60 transition-colors duration-150 ease-out hover:text-accent"
                @click="clearFilters"
              >
                清除全部筛选
              </button>
            </div>
          </div>

          <ul class="mt-4 flex flex-wrap gap-2">
            <li
              v-for="chip in activeFilterChips"
              :key="`${chip.category}:${chip.value}`"
              class="inline-flex items-center gap-2 border px-3 py-1.5"
              :class="chip.valid ? 'border-line' : 'border-accent text-accent'"
            >
              <span class="swiss-meta">{{ chip.categoryLabel }}</span>
              <span class="font-sans text-xs font-bold">{{ chip.label }}</span>
              <span v-if="!chip.valid" class="swiss-meta">已失效</span>
              <button
                type="button"
                class="cursor-pointer text-black/45 transition-colors duration-150 ease-out hover:text-accent"
                :aria-label="`移除${chip.categoryLabel}条件 ${chip.label}`"
                @click="removeFilterValue(chip.category, chip.value)"
              >
                ×
              </button>
            </li>
          </ul>

          <p
            v-if="invalidFilterChips.length"
            class="mt-3 font-sans text-xs leading-relaxed text-accent"
            role="alert"
          >
            {{ invalidFilterChips.length }} 个索引条件已失效（词条被删除，或对应作品已下线）。
            它们仍参与筛选，所以结果可能为空；可以单独移除，或点「清除失效条件」。
          </p>
        </div>

        <!-- 结果头 -->
        <div
          class="mb-12 mt-12 flex flex-wrap items-end justify-between gap-4 border-b border-black pb-4"
        >
          <h2 class="font-sans text-2xl font-bold uppercase tracking-tight">游戏库</h2>
          <p class="swiss-meta text-black/60" aria-live="polite">
            <span v-if="isLoading">载入中…</span>
            <span v-else>命中 {{ total }} 款 · 第 {{ currentPage }} / {{ totalPages }} 页</span>
          </p>
        </div>

        <!-- 载入骨架 -->
        <div
          v-if="isLoading"
          class="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3"
          aria-hidden="true"
        >
          <div
            v-for="key in SKELETON_KEYS"
            :key="key"
            class="border border-black border-l-4 border-l-transparent bg-white"
          >
            <div class="aspect-[16/9] w-full border-b border-black bg-surface" />
            <div class="px-6 py-6 md:px-8 md:py-8">
              <div class="h-5 w-3/4 bg-surface" />
              <div class="mt-5 h-3 w-1/2 bg-surface" />
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else-if="games.length === 0" class="border border-black px-6 py-20 md:px-12 md:py-24">
          <p class="font-sans text-3xl font-bold uppercase tracking-tight">No Results</p>
          <p class="mt-5 max-w-[52ch] font-sans text-sm leading-relaxed text-black/60">
            当前筛选条件下没有匹配的游戏。试试更换关键词，或清除全部筛选条件。
          </p>
          <button
            v-if="hasActiveFilters"
            type="button"
            class="group mt-10 inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent"
            @click="clearFilters"
          >
            <span>清除全部筛选</span>
            <span class="u-arrow" aria-hidden="true">&#8594;</span>
          </button>
        </div>

        <!-- 游戏网格：12 列衍生，1 / 2 / 3 列 -->
        <div v-else class="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          <GameCard v-for="game in games" :key="game.id" :game="game" />
        </div>

        <!-- 分页 -->
        <nav
          v-if="!isLoading && totalPages > 1"
          class="mt-16 flex flex-wrap items-center justify-between gap-6 border-t border-black pt-6"
          aria-label="分页"
        >
          <button
            type="button"
            class="group inline-flex items-center gap-4 border border-black px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-black"
            :disabled="currentPage <= 1"
            @click="setPage(currentPage - 1)"
          >
            <span class="u-arrow-back" aria-hidden="true">&#8594;</span>
            <span>上一页</span>
          </button>

          <p class="swiss-meta text-black/60">第 {{ currentPage }} / {{ totalPages }} 页</p>

          <button
            type="button"
            class="group inline-flex items-center gap-4 border border-black px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-black"
            :disabled="currentPage >= totalPages"
            @click="setPage(currentPage + 1)"
          >
            <span>下一页</span>
            <span class="u-arrow" aria-hidden="true">&#8594;</span>
          </button>
        </nav>
      </div>
    </section>

    <ResourceRequestDialog :open="requestDialogOpen" @close="closeRequestDialog" />
  </div>
</template>
