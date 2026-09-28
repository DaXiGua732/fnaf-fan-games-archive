<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  useGameLibrary,
  type FilterCategory,
  type SortKey,
} from '../composables/useGameLibrary'
import StyleAuditBadge from '../components/StyleAuditBadge.vue'
import { runLibraryAssertions, type Assertion } from '../dev/libraryAssertions'

/* 阶段二临时调试视图 —— 用于验证深模块接口能否准确筛选出目标游戏。
   阶段四开发首页后此视图可删除或移入 /debug 路由。 */

const library = useGameLibrary()

const {
  games,
  filtered,
  isLoading,
  total,
  totalPages,
  currentPage,
  availableAuthors,
  availableYears,
  availableSeries,
  activeFilters,
  hasActiveFilters,
  setSearchQuery,
  setFilter,
  clearFilters,
  setSortBy,
  setPage,
  setPageSize,
  isFilterActive,
} = useGameLibrary()

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'views', label: '热度' },
  { key: 'score', label: '评分' },
  { key: 'title', label: '首字母' },
  { key: 'year', label: '年份' },
]

const PAGE_SIZE_OPTIONS = [12, 4, 2]

const FILTER_GROUPS: {
  category: FilterCategory
  title: string
  options: () => string[]
}[] = [
  { category: 'author', title: '作者', options: () => availableAuthors.value },
  { category: 'year', title: '年份', options: () => availableYears.value.map(String) },
  { category: 'series', title: 'IP 系列', options: () => availableSeries.value },
]

function onSearchInput(event: Event): void {
  setSearchQuery((event.target as HTMLInputElement).value)
}

function chipClass(category: FilterCategory, value: string): string {
  return isFilterActive(category, value)
    ? 'border-[#ff0000] bg-black text-white'
    : 'border-[#cccccc] bg-white text-black hover:border-black'
}

/* ==========================================================================
   接口自检
   断言集放在 src/dev/libraryAssertions.ts，与 `npm run selftest` 共用同一份实现，
   保证「浏览器里的自检」与「命令行自检」结果永远一致，不会两处漂移。
   ========================================================================== */
const assertions = ref<Assertion[]>([])
const testing = ref(false)

async function runSelfTest(): Promise<void> {
  testing.value = true
  assertions.value = []
  assertions.value = await runLibraryAssertions(library)
  testing.value = false
}

onMounted(runSelfTest)
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="bg-[#ff0000] text-white">
      <div class="mx-auto max-w-[1280px] px-6 py-20 md:px-12 md:py-24">
        <p class="swiss-meta mb-6">Stage 02 — Deep Module</p>
        <h1 class="font-sans text-4xl font-bold uppercase leading-[0.95] tracking-[-0.03em] md:text-6xl">
          Game Library<br />Debug Console
        </h1>
        <p class="mt-8 max-w-[62ch] font-sans text-sm leading-relaxed text-white/90">
          深模块对外只暴露 setSearchQuery / setFilter / clearFilters / getGameById 等极简接口。
          本页所有筛选、排序、分页结果均由 useGameLibrary 计算，视图层没有一行 .filter() 逻辑。
        </p>
      </div>
    </section>

    <!-- 接口自检 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12">
        <div class="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p class="swiss-meta mb-3">01 — Interface Self-Test</p>
            <h2 class="font-sans text-2xl font-bold uppercase tracking-tight">
              接口行为断言
            </h2>
          </div>
          <button
            type="button"
            class="rounded-none border border-black bg-white px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 hover:bg-black hover:text-white disabled:opacity-40"
            :disabled="testing"
            @click="runSelfTest"
          >
            {{ testing ? '测试中…' : '重新运行自检' }}
          </button>
        </div>

        <div v-if="assertions.length" class="border border-black">
          <div class="flex items-center justify-between border-b border-[#cccccc] px-6 py-3">
            <span class="swiss-meta">
              共 {{ assertions.length }} 项 · 通过 {{ assertions.filter((a) => a.pass).length }} 项
            </span>
            <span
              class="swiss-meta font-bold"
              :class="assertions.every((a) => a.pass) ? 'text-black' : 'text-[#ff0000]'"
            >
              {{ assertions.every((a) => a.pass) ? 'ALL PASS' : 'FAILED' }}
            </span>
          </div>
          <table class="w-full border-collapse text-left">
            <thead>
              <tr class="border-b border-black">
                <th class="swiss-meta px-6 py-3 font-normal">结果</th>
                <th class="swiss-meta px-6 py-3 font-normal">断言</th>
                <th class="swiss-meta px-6 py-3 font-normal">期望</th>
                <th class="swiss-meta px-6 py-3 font-normal">实际</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in assertions" :key="item.name" class="border-b border-[#cccccc]">
                <td class="swiss-meta px-6 py-3" :class="item.pass ? 'text-black' : 'text-[#ff0000]'">
                  {{ item.pass ? 'PASS' : 'FAIL' }}
                </td>
                <td class="px-6 py-3 font-sans text-xs">{{ item.name }}</td>
                <td class="px-6 py-3 font-sans text-xs text-black/60">{{ item.expected }}</td>
                <td class="px-6 py-3 font-sans text-xs text-black/60">{{ item.actual }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="swiss-meta text-black/50">自检运行中…</p>
      </div>
    </section>

    <!-- 控制台 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12">
        <p class="swiss-meta mb-8">02 — Query Console</p>

        <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <!-- 左：搜索 + 过滤 + 结果 -->
          <div>
            <label class="swiss-meta mb-3 block text-black/60" for="debug-search">关键词搜索</label>
            <input
              id="debug-search"
              type="text"
              placeholder="输入标题 / 作者 / 系列 / 引擎…"
              :value="activeFilters.search"
              class="mb-10 w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none"
              @input="onSearchInput"
            />

            <div v-for="group in FILTER_GROUPS" :key="group.category" class="mb-10">
              <p class="swiss-meta mb-4 text-black/60">{{ group.title }}</p>
              <div class="flex flex-wrap gap-3">
                <button
                  v-for="option in group.options()"
                  :key="option"
                  type="button"
                  class="rounded-none border px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150"
                  :class="chipClass(group.category, option)"
                  @click="setFilter(group.category, option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-8 border-t border-[#cccccc] pt-8">
              <div>
                <p class="swiss-meta mb-3 text-black/60">排序</p>
                <div class="flex flex-wrap gap-3">
                  <button
                    v-for="option in SORT_OPTIONS"
                    :key="option.key"
                    type="button"
                    class="rounded-none border px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150"
                    :class="
                      activeFilters.sort === option.key
                        ? 'border-[#ff0000] bg-black text-white'
                        : 'border-[#cccccc] bg-white text-black hover:border-black'
                    "
                    @click="setSortBy(option.key)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <div>
                <p class="swiss-meta mb-3 text-black/60">每页条数</p>
                <div class="flex flex-wrap gap-3">
                  <button
                    v-for="option in PAGE_SIZE_OPTIONS"
                    :key="option"
                    type="button"
                    class="rounded-none border px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150"
                    :class="
                      activeFilters.pageSize === option
                        ? 'border-[#ff0000] bg-black text-white'
                        : 'border-[#cccccc] bg-white text-black hover:border-black'
                    "
                    @click="setPageSize(option)"
                  >
                    {{ option }}
                  </button>
                </div>
              </div>

              <div class="ml-auto">
                <button
                  type="button"
                  class="rounded-none border border-black px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 disabled:opacity-40"
                  :class="
                    hasActiveFilters
                      ? 'bg-white text-black hover:bg-[#ff0000] hover:text-white hover:border-[#ff0000]'
                      : ''
                  "
                  :disabled="!hasActiveFilters"
                  @click="clearFilters"
                >
                  清除全部筛选
                </button>
              </div>
            </div>
          </div>

          <!-- 右：状态快照 -->
          <aside class="border border-black">
            <div class="flex items-center justify-between border-b border-[#cccccc] px-5 py-3">
              <span class="swiss-meta">API 状态快照</span>
              <span class="swiss-meta font-bold" :class="isLoading ? 'text-[#ff0000]' : 'text-black'">
                {{ isLoading ? 'LOADING' : 'READY' }}
              </span>
            </div>
            <dl class="divide-y divide-[#cccccc] font-sans text-xs">
              <div class="flex justify-between px-5 py-3">
                <dt class="text-black/60">命中总数 (total)</dt>
                <dd class="font-bold">{{ total }}</dd>
              </div>
              <div class="flex justify-between px-5 py-3">
                <dt class="text-black/60">当前页 (currentPage)</dt>
                <dd class="font-bold">{{ currentPage }} / {{ totalPages }}</dd>
              </div>
              <div class="flex justify-between px-5 py-3">
                <dt class="text-black/60">本页条数 (games.length)</dt>
                <dd class="font-bold">{{ games.length }}</dd>
              </div>
              <div class="flex justify-between px-5 py-3">
                <dt class="text-black/60">hasActiveFilters</dt>
                <dd class="font-bold">{{ hasActiveFilters }}</dd>
              </div>
            </dl>
            <div class="border-t border-[#cccccc] px-5 py-4">
              <p class="swiss-meta mb-3 text-black/60">activeFilters</p>
              <pre class="overflow-x-auto font-sans text-[11px] leading-relaxed text-black/70">{{ JSON.stringify(activeFilters, null, 2) }}</pre>
            </div>
            <div class="border-t border-[#cccccc] px-5 py-4">
              <p class="swiss-meta mb-3 text-black/60">分页</p>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="rounded-none border border-black px-3 py-1 font-sans text-[11px] font-bold transition-colors duration-150 hover:bg-black hover:text-white disabled:opacity-30"
                  :disabled="currentPage <= 1"
                  @click="setPage(currentPage - 1)"
                >
                  ←
                </button>
                <span class="font-sans text-[11px]">{{ currentPage }} / {{ totalPages }}</span>
                <button
                  type="button"
                  class="rounded-none border border-black px-3 py-1 font-sans text-[11px] font-bold transition-colors duration-150 hover:bg-black hover:text-white disabled:opacity-30"
                  :disabled="currentPage >= totalPages"
                  @click="setPage(currentPage + 1)"
                >
                  →
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>

    <!-- 结果表 -->
    <section class="border-b border-black">
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12">
        <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
          <p class="swiss-meta">03 — Result Set</p>
          <p class="swiss-meta text-black/60">
            过滤后 {{ filtered.length }} 条 · 本页渲染 {{ games.length }} 条
          </p>
        </div>

        <div v-if="games.length" class="overflow-x-auto border border-black">
          <table class="w-full border-collapse text-left">
            <thead>
              <tr class="border-b border-black">
                <th class="swiss-meta px-5 py-3 font-normal">#</th>
                <th class="swiss-meta px-5 py-3 font-normal">标题</th>
                <th class="swiss-meta px-5 py-3 font-normal">作者</th>
                <th class="swiss-meta px-5 py-3 font-normal">年份</th>
                <th class="swiss-meta px-5 py-3 font-normal">系列</th>
                <th class="swiss-meta px-5 py-3 font-normal">引擎</th>
                <th class="swiss-meta px-5 py-3 font-normal">热度</th>
                <th class="swiss-meta px-5 py-3 font-normal">评分</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(game, i) in games"
                :key="game.id"
                class="border-b border-[#cccccc] transition-colors duration-150 hover:bg-[#f9f9f9]"
              >
                <td class="px-5 py-4 font-sans text-xs text-black/50">
                  {{ String((currentPage - 1) * activeFilters.pageSize + i + 1).padStart(2, '0') }}
                </td>
                <td class="px-5 py-4 font-sans text-sm font-bold">{{ game.title }}</td>
                <td class="px-5 py-4 font-sans text-xs">{{ game.author }}</td>
                <td class="px-5 py-4 font-sans text-xs">{{ game.releaseYear }}</td>
                <td class="px-5 py-4 font-sans text-xs">{{ game.ipSeries }}</td>
                <td class="px-5 py-4 font-sans text-xs text-black/60">{{ game.engine }}</td>
                <td class="px-5 py-4 font-sans text-xs">{{ game.metrics.fakeViews.toLocaleString('en-US') }}</td>
                <td class="px-5 py-4 font-sans text-xs">{{ game.metrics.score.toFixed(1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="border border-black px-6 py-16">
          <p class="font-sans text-xl font-bold uppercase tracking-tight">No Results</p>
          <p class="mt-3 font-sans text-sm text-black/60">
            当前条件下没有匹配的游戏。请调整关键词或清除筛选。
          </p>
        </div>
      </div>
    </section>

    <!-- 视觉规范复查 -->
    <section>
      <div class="mx-auto max-w-[1280px] px-6 py-16 md:px-12">
        <p class="swiss-meta mb-6">04 — Compliance Re-check</p>
        <StyleAuditBadge />
      </div>
    </section>
  </div>
</template>
