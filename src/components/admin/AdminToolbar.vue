<script setup lang="ts">
import { useSearchField } from '../../composables/useSearchField'
import { computed } from 'vue'
import { useAdminGames } from '../../composables/useAdminGames'
import {
  SORT_OPTIONS,
  STATUS_FILTER_ORDER,
  statusFilterLabel,
  type AdminSortKey,
} from '../../types/admin'

/**
 * AdminToolbar —— 搜索 / 状态 / 作者 / 标签 / 排序
 *
 * 只负责把用户意图翻译成深模块调用。
 * 全部过滤、排序、计数都在 useAdminGames 内，本组件不做任何数据加工
 * （禁止 .filter() / .sort()）。
 *
 * 下拉统一用 v-model + 可写 computed，而不是 `:value` + `@change`：
 * 对 `<select>` 直接绑 value 会在选项渲染之前赋值，导致初值不生效。
 */
const {
  activeQuery,
  hasActiveQuery,
  statusCounts,
  availableAuthors,
  availableTags,
  setSearchQuery,
  setStatusFilter,
  setAuthorFilter,
  setTagFilter,
  setSortBy,
  clearQuery,
} = useAdminGames()

const authorValue = computed<string>({
  get: () => activeQuery.value.author ?? '',
  set: (value) => setAuthorFilter(value === '' ? null : value),
})

const tagValue = computed<string>({
  get: () => activeQuery.value.tag ?? '',
  set: (value) => setTagFilter(value === '' ? null : value),
})

const sortValue = computed<string>({
  get: () => activeQuery.value.sort,
  set: (value) => setSortBy(value as AdminSortKey),
})

/**
 * 关键词输入框由本地 ref 驱动（不再用 `:value` + `@input`）——
 * 受控输入的「回写 → 浏览器重置光标」会让「反向选中后打字」变成倒序。
 * 见 composables/useSearchField.ts。
 */
const searchText = useSearchField(computed(() => activeQuery.value.search), setSearchQuery)

const SELECT_CLASS =
  'w-full appearance-none rounded-none border border-black bg-white px-4 py-3 pr-10 font-sans text-sm ' +
  'transition-colors duration-150 ease-out focus:border-[#ff0000] focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/40'

/** 选中态：深底白字 + 红边（沿用前台筛选面板的选中表现） */
function chipClass(active: boolean): string {
  return [
    'rounded-none border px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em]',
    'transition-colors duration-150 ease-out',
    active
      ? 'border-[#ff0000] bg-black text-white'
      : 'border-[#cccccc] bg-white text-black hover:border-black',
  ].join(' ')
}
</script>

<template>
  <section class="border border-black">
    <!-- ============ 搜索 ============ -->
    <div class="border-b border-[#cccccc] p-6 md:p-8">
      <label class="swiss-meta mb-3 block text-black/60" for="admin-search">关键词搜索</label>
      <input
        id="admin-search"
        type="search"
        autocomplete="off"
        placeholder="输入标题 / 作者 / IP 系列 / 引擎 / 标签…"
        v-model="searchText"
        class="w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none"
      />
    </div>

    <!-- ============ 状态 ============ -->
    <div class="grid gap-4 border-b border-[#cccccc] p-6 md:grid-cols-[120px_minmax(0,1fr)] md:p-8">
      <p class="swiss-meta pt-2 text-black/60">状态</p>
      <div class="flex flex-wrap gap-3">
        <button
          v-for="value in STATUS_FILTER_ORDER"
          :key="value"
          type="button"
          :class="chipClass(activeQuery.status === value)"
          :aria-pressed="activeQuery.status === value"
          @click="setStatusFilter(value)"
        >
          {{ statusFilterLabel(value) }}
          <span class="ml-2 opacity-60">{{ statusCounts[value] }}</span>
        </button>
      </div>
    </div>

    <!-- ============ 作者 / 标签 / 排序 / 清除 ============ -->
    <div class="grid gap-6 p-6 md:grid-cols-2 md:gap-8 md:p-8 lg:grid-cols-4">
      <div>
        <label class="swiss-meta mb-3 block text-black/60" for="admin-filter-author">作者</label>
        <div class="relative">
          <select id="admin-filter-author" v-model="authorValue" :class="SELECT_CLASS">
            <option value="">全部作者</option>
            <option v-for="author in availableAuthors" :key="author" :value="author">
              {{ author }}
            </option>
          </select>
          <span
            class="pointer-events-none absolute inset-y-0 right-4 flex items-center font-sans text-xs"
            aria-hidden="true"
            >&#9662;</span
          >
        </div>
      </div>

      <div>
        <label class="swiss-meta mb-3 block text-black/60" for="admin-filter-tag">标签</label>
        <div class="relative">
          <select
            id="admin-filter-tag"
            v-model="tagValue"
            :disabled="availableTags.length === 0"
            :class="SELECT_CLASS"
          >
            <option value="">全部标签</option>
            <option v-for="tag in availableTags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
          <span
            class="pointer-events-none absolute inset-y-0 right-4 flex items-center font-sans text-xs"
            aria-hidden="true"
            >&#9662;</span
          >
        </div>
        <p v-if="availableTags.length === 0" class="swiss-meta mt-2 text-black/35">
          数据中暂无标签
        </p>
      </div>

      <div>
        <label class="swiss-meta mb-3 block text-black/60" for="admin-filter-sort">排序</label>
        <div class="relative">
          <select id="admin-filter-sort" v-model="sortValue" :class="SELECT_CLASS">
            <option v-for="option in SORT_OPTIONS" :key="option.key" :value="option.key">
              {{ option.label }}
            </option>
          </select>
          <span
            class="pointer-events-none absolute inset-y-0 right-4 flex items-center font-sans text-xs"
            aria-hidden="true"
            >&#9662;</span
          >
        </div>
      </div>

      <div class="flex items-end">
        <button
          type="button"
          class="w-full rounded-none border border-black px-4 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 enabled:hover:border-[#ff0000] enabled:hover:bg-[#ff0000] enabled:hover:text-white"
          :disabled="!hasActiveQuery"
          @click="clearQuery"
        >
          清除全部条件
        </button>
      </div>
    </div>
  </section>
</template>
