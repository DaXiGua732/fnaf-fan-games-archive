<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useAdminGames } from '../../composables/useAdminGames'
import { assetUrl } from '../../utils/asset'
import { formatTimestamp } from '../../utils/datetime'
import AdminStatusTag from './AdminStatusTag.vue'

/**
 * AdminGameTable —— 后台游戏列表
 *
 * 数据与勾选状态全部来自 useAdminGames（模块级单例），本组件不做任何数据加工。
 *
 * 【数字列对齐】表格里的数字 / 日期列一律右对齐（`text-right` + `tabular-nums`）。
 * 这是**表格语义**的特例，不是视觉规范里被禁的「文本居中」：
 * 等宽数字右对齐才能让位数对齐，左对齐反而不可读。
 */
const {
  games,
  isSelected,
  toggleSelect,
  isPageFullySelected,
  isPagePartiallySelected,
  toggleSelectAllOnPage,
} = useAdminGames()

/** 表头定义。列宽集中在这里，保证 thead 与 tbody 的列数不会各自漂移 */
const COLUMNS: { label: string; width: string }[] = [
  { label: '封面', width: 'w-[88px]' },
  { label: '游戏名称', width: 'min-w-[220px]' },
  { label: '作者', width: 'w-[130px]' },
  { label: '系列', width: 'w-[150px]' },
  { label: '标签', width: 'w-[180px]' },
  { label: '状态', width: 'w-[120px]' },
  { label: '更新时间', width: 'w-[150px]' },
  { label: '操作', width: 'w-[130px]' },
]

/** 选择列 + 数据列，供空状态单元格的 colspan 使用 */
const COLUMN_COUNT = COLUMNS.length + 1

const CHECKBOX_CLASS =
  'h-4 w-4 shrink-0 cursor-pointer rounded-none border border-black accent-black disabled:cursor-not-allowed'
</script>

<template>
  <div class="overflow-x-auto border border-black">
    <table class="w-full min-w-[1080px] border-collapse text-left">
      <thead>
        <tr class="border-b border-black">
          <th class="w-12 border-r border-[#cccccc] px-4 py-4 align-middle">
            <input
              type="checkbox"
              :class="CHECKBOX_CLASS"
              :checked="isPageFullySelected"
              :indeterminate="isPagePartiallySelected"
              :aria-label="isPageFullySelected ? '取消选择本页全部' : '选择本页全部'"
              @change="toggleSelectAllOnPage"
            />
          </th>
          <th
            v-for="column in COLUMNS"
            :key="column.label"
            class="border-r border-[#cccccc] px-4 py-4 align-middle whitespace-nowrap last:border-r-0"
            :class="column.width"
          >
            <span class="swiss-meta font-normal text-black/60">{{ column.label }}</span>
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="game in games"
          :key="game.id"
          class="border-b border-[#cccccc] transition-colors duration-150 ease-out last:border-b-0"
          :class="isSelected(game.id) ? 'bg-[#f9f9f9]' : 'hover:bg-[#f9f9f9]'"
        >
          <!-- 选择 -->
          <td class="border-r border-[#cccccc] px-4 py-4 align-middle">
            <input
              type="checkbox"
              :class="CHECKBOX_CLASS"
              :checked="isSelected(game.id)"
              :aria-label="`选择 ${game.title}`"
              @change="toggleSelect(game.id)"
            />
          </td>

          <!-- 封面 -->
          <td class="border-r border-[#cccccc] px-4 py-3 align-middle">
            <img
              :src="assetUrl(game.coverImage)"
              :alt="`${game.title} 封面`"
              class="h-10 w-16 border border-black object-cover"
              loading="lazy"
              decoding="async"
            />
          </td>

          <!-- 游戏名称 -->
          <td class="border-r border-[#cccccc] px-4 py-3 align-middle">
            <p class="font-sans text-sm font-bold">{{ game.title }}</p>
            <p class="swiss-meta mt-1 text-black/35">{{ game.id }}</p>
          </td>

          <!-- 作者 -->
          <td class="border-r border-[#cccccc] px-4 py-3 align-middle">
            <span class="font-sans text-xs">{{ game.author }}</span>
          </td>

          <!-- 系列 -->
          <td class="border-r border-[#cccccc] px-4 py-3 align-middle">
            <span class="font-sans text-xs">{{ game.ipSeries }}</span>
          </td>

          <!-- 标签 -->
          <td class="border-r border-[#cccccc] px-4 py-3 align-middle">
            <div v-if="game.tags.length" class="flex flex-wrap gap-2">
              <span
                v-for="tag in game.tags"
                :key="tag"
                class="border border-[#cccccc] px-2 py-1 font-sans text-[11px] whitespace-nowrap"
              >
                {{ tag }}
              </span>
            </div>
            <span v-else class="font-sans text-xs text-black/30">—</span>
          </td>

          <!-- 状态 -->
          <td class="border-r border-[#cccccc] px-4 py-3 align-middle">
            <AdminStatusTag :status="game.status" :archived="game.archived" />
          </td>

          <!-- 更新时间（含操作者） -->
          <td class="border-r border-[#cccccc] px-4 py-3 align-middle text-right">
            <span class="font-sans text-xs tabular-nums text-black/70">
              {{ formatTimestamp(game.updatedAt) }}
            </span>
            <!-- Phase 19：谁最后碰过这条数据。多人后台里它跟时间同等重要 -->
            <span v-if="game.updatedBy" class="swiss-meta mt-1 block text-black/45">
              {{ game.updatedBy }}
            </span>
          </td>

          <!-- 操作 -->
          <td class="px-4 py-3 align-middle">
            <div class="flex flex-col items-start gap-2">
              <RouterLink
                :to="{ name: 'game', params: { id: game.id } }"
                target="_blank"
                rel="noopener noreferrer"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-[#ff0000]"
              >
                预览 &#8599;
              </RouterLink>

              <RouterLink
                :to="{ name: 'admin-game-edit', params: { id: game.id } }"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-[#ff0000]"
              >
                编辑
              </RouterLink>
            </div>
          </td>
        </tr>

        <!-- 空状态 -->
        <tr v-if="games.length === 0">
          <td :colspan="COLUMN_COUNT" class="px-6 py-20 md:px-8 md:py-24">
            <p class="font-sans text-xl font-bold uppercase tracking-tight">No Results</p>
            <p class="mt-5 max-w-[56ch] font-sans text-sm leading-relaxed text-black/60">
              当前筛选条件下没有匹配的游戏。调整关键词或状态筛选，或使用工具栏的「清除全部条件」。
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
