<script setup lang="ts">
import { computed } from 'vue'
import FilterPanel from '../components/FilterPanel.vue'
import GameCard from '../components/GameCard.vue'
import { useGameLibrary } from '../composables/useGameLibrary'

/* 首页：探索与筛选。所有数据加工都在深模块内，本页只负责渲染。 */
const {
  catalogSize,
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
} = useGameLibrary()

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
    <section class="bg-[#ff0000] text-white">
      <div class="mx-auto max-w-[1280px] px-6 py-24 md:px-12 md:py-32">
        <p class="swiss-meta mb-8">Five Nights at Freddy's — Fan Game Repository</p>
        <h1
          class="font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-7xl"
        >
          FNAF Fan Games<br />Archive
        </h1>
        <p class="mt-10 max-w-[56ch] font-sans text-base leading-relaxed text-white/90">
          收录 Five Nights at Freddy's 系列同人游戏。按年份、作者、IP 系列交叉检索，
          一键跳转第三方网盘下载。
        </p>

        <dl
          class="mt-16 grid max-w-[760px] grid-cols-2 gap-8 border-t border-white/30 pt-8 sm:grid-cols-3"
        >
          <div>
            <dt class="swiss-meta text-white/70">收录作品</dt>
            <dd class="mt-2 font-sans text-3xl font-bold leading-none">{{ catalogSize }}</dd>
          </div>
          <div>
            <dt class="swiss-meta text-white/70">创作者</dt>
            <dd class="mt-2 font-sans text-3xl font-bold leading-none">
              {{ availableAuthors.length }}
            </dd>
          </div>
          <div>
            <dt class="swiss-meta text-white/70">年份跨度</dt>
            <dd class="mt-2 font-sans text-3xl font-bold leading-none">{{ yearRange }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- ============ 探索与筛选 ============ -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12 md:py-24">
        <p class="swiss-meta mb-8">01 — Explore &amp; Filter</p>

        <FilterPanel />

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
            <div class="aspect-[16/9] w-full border-b border-black bg-[#f9f9f9]" />
            <div class="px-6 py-6 md:px-8 md:py-8">
              <div class="h-5 w-3/4 bg-[#f9f9f9]" />
              <div class="mt-5 h-3 w-1/2 bg-[#f9f9f9]" />
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
            class="group mt-10 inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-[#ff0000] hover:bg-[#ff0000]"
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
            <span class="u-arrow rotate-180" aria-hidden="true">&#8594;</span>
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
  </div>
</template>
