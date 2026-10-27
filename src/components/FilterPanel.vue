<script setup lang="ts">
import { computed } from 'vue'
import { useGameLibrary, type FilterCategory, type SortKey } from '../composables/useGameLibrary'
import { useSearchField } from '../composables/useSearchField'

/**
 * FilterPanel —— 筛选与排序面板
 *
 * 只负责「把用户意图翻译成深模块调用」。
 * 全部过滤 / 排序 / 计数逻辑都在 useGameLibrary 内部，本组件不做任何数据加工。
 */
const {
  availableAuthors,
  availableYears,
  availableSeries,
  availableGameplayTypes,
  availableMechanics,
  availablePlatforms,
  availableTags,
  availableEngines,
  activeFilters,
  hasActiveFilters,
  setSearchQuery,
  setFilter,
  clearFilters,
  setSortBy,
  isFilterActive,
} = useGameLibrary()

interface FilterOption {
  /** 写进查询状态 / URL 的值：词条场景是稳定 id */
  value: string
  /** 展示文案：词条场景是名称 */
  label: string
}

interface FilterGroup {
  category: FilterCategory
  label: string
  /** 用函数取值，保证 options 始终反映最新的可见目录；空分组由模板跳过 */
  options: () => FilterOption[]
}

/**
 * 分组顺序：玩法 → 机制 → 平台 → 作者 → 系列 → 年份 → 引擎 → 标签。
 * 先按「怎么玩」组织，再按标准资料，最后是自由标签。
 */
const GROUPS: FilterGroup[] = [
  {
    category: 'gameplay',
    label: '玩法类型',
    options: () =>
      availableGameplayTypes.value.map((entry) => ({ value: entry.id, label: entry.name })),
  },
  {
    category: 'mechanic',
    label: '游戏机制',
    options: () =>
      availableMechanics.value.map((entry) => ({ value: entry.id, label: entry.name })),
  },
  {
    category: 'platform',
    label: '支持平台',
    options: () =>
      availablePlatforms.value.map((entry) => ({ value: entry.id, label: entry.name })),
  },
  {
    category: 'author',
    label: '作者',
    options: () => availableAuthors.value.map((author) => ({ value: author, label: author })),
  },
  {
    category: 'series',
    label: 'IP 系列',
    options: () => availableSeries.value.map((series) => ({ value: series, label: series })),
  },
  {
    category: 'year',
    label: '年份',
    options: () =>
      availableYears.value.map((year) => ({ value: String(year), label: String(year) })),
  },
  {
    category: 'engine',
    label: '开发引擎',
    options: () => availableEngines.value.map((engine) => ({ value: engine, label: engine })),
  },
  {
    category: 'tag',
    label: '标签',
    options: () => availableTags.value.map((tag) => ({ value: tag, label: tag })),
  },
]

/** 每次元数据变化只算一次选项；空分组由模板跳过 */
const groups = computed(() =>
  GROUPS.map((group) => ({ ...group, options: group.options() })),
)

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recommended', label: '推荐' },
  { key: 'views', label: '热度' },
  { key: 'score', label: '评分' },
  { key: 'title', label: '首字母' },
  { key: 'year', label: '年份' },
]

/** 选中态：深色背景 + 红色边框（规范允许的两种选中表现合并使用） */
function chipClass(active: boolean): string {
  return [
    'rounded-none border px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em]',
    'transition-colors duration-150 ease-out',
    active
      ? 'border-accent bg-black text-white'
      : 'border-line bg-white text-black hover:border-black',
  ].join(' ')
}

/**
 * 关键词输入框的值由本地 ref 驱动（不再用 `:value` + `@input`）。
 * 原因见 useSearchField：受控输入的「回写 → 浏览器重置光标」会让
 * 「反向选中后打字」变成倒序。
 */
const searchText = useSearchField(
  computed(() => activeFilters.value.search),
  setSearchQuery,
)
</script>

<template>
  <section class="border border-black">
    <!-- 搜索 -->
    <div class="border-b border-line p-6 md:p-8">
      <label class="swiss-meta mb-3 block text-black/60" for="library-search">关键词搜索</label>
      <input
        id="library-search"
        v-model="searchText"
        type="search"
        autocomplete="off"
        placeholder="输入标题 / 别名 / 作者 / 系列 / 引擎 / 玩法 / 机制 / 平台…"
        class="w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-accent focus:outline-none"
        />
    </div>

    <!-- 分类标签：空分组不渲染（数据里没有的分类不会留下一排空标题） -->
    <div class="divide-y divide-line">
      <template v-for="group in groups" :key="group.category">
        <div
          v-if="group.options.length > 0"
          role="group"
          :aria-label="group.label"
          class="grid gap-4 p-6 md:grid-cols-[120px_minmax(0,1fr)] md:p-8"
        >
          <p class="swiss-meta pt-2 text-black/60">{{ group.label }}</p>
          <div class="flex flex-wrap gap-3">
            <button
              v-for="option in group.options"
              :key="option.value"
              type="button"
              :class="chipClass(isFilterActive(group.category, option.value))"
              :aria-pressed="isFilterActive(group.category, option.value)"
              @click="setFilter(group.category, option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 排序 + 清除 -->
    <div class="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-black p-6 md:p-8">
      <div class="flex flex-wrap items-center gap-3">
        <span class="swiss-meta text-black/60">排序</span>
        <button
          v-for="sort in SORTS"
          :key="sort.key"
          type="button"
          :class="chipClass(activeFilters.sort === sort.key)"
          :aria-pressed="activeFilters.sort === sort.key"
          @click="setSortBy(sort.key)"
        >
          {{ sort.label }}
        </button>
      </div>

      <button
        type="button"
        class="ml-auto rounded-none border border-black px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-30 enabled:hover:border-accent-surface enabled:hover:bg-accent-surface enabled:hover:text-on-accent"
        :disabled="!hasActiveFilters"
        @click="clearFilters"
      >
        清除全部筛选
      </button>
    </div>
  </section>
</template>
