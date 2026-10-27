<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAdminGames } from '../../composables/useAdminGames'
import { PREVIEW_PATH, publishPreview } from '../../composables/useGamePreview'
import type { AdminGame } from '../../types/admin'
import { assetUrl } from '../../utils/asset'
import { formatTimestamp } from '../../utils/datetime'
import AdminConfirmDialog from './AdminConfirmDialog.vue'
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
  batchSetStatus,
  deleteGame,
  dismissDelete,
} = useAdminGames()

/**
 * 行内快捷上下线（参考创作中心列表的可见性快捷操作）。
 *
 * 走的是批量写入的同一条路径，所以结果条会如实报「实际改动 1 项」；
 * 命名刻意加上「这条」，避免和批量条的「上线 / 下线」按钮重名 ——
 * 重名会让自动化测试与屏幕阅读器都分不清点的是哪一个。
 */
const busyId = ref('')

async function toggleVisibility(game: AdminGame): Promise<void> {
  if (busyId.value) return
  busyId.value = game.id
  try {
    await batchSetStatus([game.id], game.status === 'published' ? 'offline' : 'published')
  } finally {
    busyId.value = ''
  }
}

function toggleLabel(game: AdminGame): string {
  return game.status === 'published' ? '下线这条' : '上线这条'
}

/**
 * 列表行内「预览」。
 *
 * 不能直接链到公开详情页：草稿 / 已下线 / 已归档的条目在公开路由里是 404，
 * 那会让管理员以为「预览坏了」。这里走后台自己的预览通道 ——
 * 把已保存的条目写进 localStorage，再打开受登录保护的 /admin/preview。
 */
function openPreview(game: AdminGame): void {
  publishPreview(game)
  window.open(`${import.meta.env.BASE_URL}#${PREVIEW_PATH}`, '_blank', 'noopener')
}

/* ---------------------------------------------------------------------------
   行内永久删除
   ---------------------------------------------------------------------------
   删除不是「第三种状态」—— 它会把条目从 db.json 里移除，删完就不存在了。
   所以走**二次确认弹窗**：点「删除这条」→ 弹窗里再点「确认永久删除」。
   --------------------------------------------------------------------------- */
const deleteTarget = ref<AdminGame | null>(null)
const deleteError = ref('')
const deleting = ref(false)
/** 删除成功后就地留一条确认，避免「弹窗一关，不知道删没删」 */
const deleteDone = ref<{ title: string; imagesCleaned: number } | null>(null)

function requestDelete(game: AdminGame): void {
  deleteTarget.value = game
  deleteError.value = ''
  deleteDone.value = null
}

function cancelDelete(): void {
  if (deleting.value) return
  deleteTarget.value = null
  deleteError.value = ''
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target || deleting.value) return

  deleting.value = true
  deleteError.value = ''
  try {
    const outcome = await deleteGame(target.id)
    deleteDone.value = { title: outcome.title, imagesCleaned: outcome.imagesCleaned }
    deleteTarget.value = null
    // 结果已在下方就地展示，收起页面顶部的全局提示条，避免同一条结果出现两次
    dismissDelete()
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : '删除失败，请重试。'
  } finally {
    deleting.value = false
  }
}

/** 表头定义。列宽集中在这里，保证 thead 与 tbody 的列数不会各自漂移 */
const COLUMNS: { label: string; width: string }[] = [
  { label: '封面', width: 'w-[112px]' },
  { label: '游戏名称', width: 'min-w-[260px]' },
  { label: '标签', width: 'w-[150px]' },
  { label: '状态', width: 'w-[110px]' },
  { label: '更新时间', width: 'w-[140px]' },
  { label: '操作', width: 'w-[150px]' },
]

/** 选择列 + 数据列，供空状态单元格的 colspan 使用 */
const COLUMN_COUNT = COLUMNS.length + 1

const CHECKBOX_CLASS =
  'h-4 w-4 shrink-0 cursor-pointer rounded-none border border-black accent-black disabled:cursor-not-allowed'
</script>

<template>
  <div>
    <div class="overflow-x-auto border border-black">
      <table class="w-full min-w-[980px] border-collapse text-left">
      <thead>
        <tr class="border-b border-black">
          <th class="w-12 border-r border-line px-4 py-4 align-middle">
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
            class="border-r border-line px-4 py-4 align-middle whitespace-nowrap last:border-r-0"
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
          class="border-b border-line transition-colors duration-150 ease-out last:border-b-0"
          :class="isSelected(game.id) ? 'bg-surface' : 'hover:bg-surface'"
        >
          <!-- 选择 -->
          <td class="border-r border-line px-4 py-4 align-middle">
            <input
              type="checkbox"
              :class="CHECKBOX_CLASS"
              :checked="isSelected(game.id)"
              :aria-label="`选择 ${game.title}`"
              @change="toggleSelect(game.id)"
            />
          </td>

          <!-- 封面 -->
          <td class="border-r border-line px-4 py-3 align-middle">
            <img
              :src="assetUrl(game.coverImage)"
              :alt="`${game.title} 封面`"
              class="h-12 w-20 border border-black bg-surface object-cover md:h-14 md:w-24"
              loading="lazy"
              decoding="async"
            />
          </td>

          <!-- 游戏名称 —— 点标题直接进编辑页；作者 / 系列收进第二行，少两列 -->
          <td class="border-r border-line px-4 py-3 align-middle">
            <RouterLink
              :to="{ name: 'admin-game-edit', params: { id: game.id } }"
              class="font-sans text-sm font-bold transition-colors duration-150 ease-out hover:text-accent"
            >
              {{ game.title }}
            </RouterLink>
            <p class="mt-1 font-sans text-[11px] text-black/50">
              {{ game.author }} · {{ game.ipSeries }}
            </p>
            <p class="swiss-meta mt-1 text-black/30">{{ game.id }}</p>
          </td>

          <!-- 标签 -->
          <td class="border-r border-line px-4 py-3 align-middle">
            <div v-if="game.tags.length" class="flex flex-wrap gap-2">
              <span
                v-for="tag in game.tags"
                :key="tag"
                class="border border-line px-2 py-1 font-sans text-[11px] whitespace-nowrap"
              >
                {{ tag }}
              </span>
            </div>
            <span v-else class="font-sans text-xs text-black/30">—</span>
          </td>

          <!-- 状态 -->
          <td class="border-r border-line px-4 py-3 align-middle">
            <AdminStatusTag :status="game.status" :archived="game.archived" />
          </td>

          <!-- 更新时间（含操作者） -->
          <td class="border-r border-line px-4 py-3 align-middle text-right">
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
                :to="{ name: 'admin-game-edit', params: { id: game.id } }"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-accent"
              >
                编辑
              </RouterLink>

              <button
                type="button"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-accent"
                :title="`预览 ${game.title}（草稿和已下线也能看）`"
                @click="openPreview(game)"
              >
                预览 &#8599;
              </button>

              <button
                type="button"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:text-black/30"
                :class="
                  game.status === 'published'
                    ? 'text-accent hover:text-black'
                    : 'text-black/60 hover:text-accent'
                "
                :disabled="Boolean(busyId)"
                :title="`马上${toggleLabel(game)}（会保存到数据仓）`"
                @click="toggleVisibility(game)"
              >
                {{ busyId === game.id ? '处理中…' : toggleLabel(game) }}
              </button>

              <button
                type="button"
                class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-black/35 transition-colors duration-150 ease-out hover:text-accent"
                title="从数据仓永久删除（不可撤销）"
                @click="requestDelete(game)"
              >
                删除这条
              </button>
            </div>
          </td>
        </tr>

        <!-- 空状态 -->
        <tr v-if="games.length === 0">
          <td :colspan="COLUMN_COUNT" class="px-6 py-20 md:px-8 md:py-24">
            <p class="font-sans text-xl font-bold uppercase tracking-tight">No Results</p>
            <p class="mt-5 max-w-[56ch] font-sans text-sm leading-relaxed text-black/60">
              没有找到符合条件的游戏。换个关键词、调整筛选，或者点工具栏的「清除全部条件」。
            </p>
          </td>
        </tr>
      </tbody>
      </table>
    </div>

    <!-- ============ 永久删除：二次确认弹窗 ============ -->
    <AdminConfirmDialog
      :open="Boolean(deleteTarget)"
      title="确认永久删除？"
      confirm-label="确认永久删除"
      :busy="deleting"
      :error="deleteError"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    >
      <p>
        会把《{{ deleteTarget?.title }}》（<span class="font-bold tracking-[0.08em]">{{
          deleteTarget?.id
        }}</span
        >）从数据仓里删掉，并清掉只有它在用的上传图片。
      </p>
      <p class="mt-3">
        这一步没法撤销，删掉后也找不回来。前台下次打开或切回页面时会自动同步（一般几秒），
        到时候它就会消失。
      </p>
    </AdminConfirmDialog>
    <!-- ============ 删除成功（就地确认） ============ -->
    <div
      v-if="deleteDone && !deleteTarget"
      class="mt-4 border border-line border-l-4 border-l-accent px-6 py-4"
      role="status"
      aria-live="polite"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="font-sans text-sm font-bold">已永久删除《{{ deleteDone.title }}》</p>
          <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/65">
            <template v-if="deleteDone.imagesCleaned > 0">
              顺手删掉了 {{ deleteDone.imagesCleaned }} 张只有它在用的上传图片。
            </template>
            <template v-else>没有需要清理的专属图片。</template>
            已经提交到数据仓，前台下次打开或切回页面时就会消失。
          </p>
        </div>
        <button
          type="button"
          class="rounded-none border border-transparent px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-black/55 transition-colors duration-150 ease-out hover:text-accent"
          @click="deleteDone = null"
        >
          知道了
        </button>
      </div>
    </div>
  </div>
</template>
