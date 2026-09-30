<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAdminGames } from '../../composables/useAdminGames'

/**
 * AdminBatchBar —— 批量操作条
 *
 * 两种形态：
 *   未选择 → 一行细提示，说明「勾选后可批量操作」
 *   已选择 → 「已选择 N 项」+ 动作按钮组（+ 需要时展开的确认 / 录入面板）
 *
 * 【为什么未选择时也渲染这一条】
 *   计划书描述的是「未选择 = 普通工具栏；选择后 = 换成批量条」的切换。这里改成同一条
 *   bar 的两种形态，理由有二：
 *     ① 避免列表跳动 —— 工具栏与批量条高度不同，切换时整张表格会上下弹一下；
 *     ② SSR 冒烟只能渲染「未选择」态，常驻渲染让这一态也能被自动断言覆盖，
 *        而不是整条 bar 全靠人工点击验收。
 *
 * 【二次确认的范围】会**减少前台可见内容**的动作才需要确认：下线、归档。
 *   上线 / 取消归档 / 加减标签 / 改作者都可逆且不减少可见性，直接执行。
 *   删除（计划书里的典型危险操作）属于本阶段范围之外，见计划书 §Phase 3。
 */
type BatchActionId =
  | 'publish'
  | 'unpublish'
  | 'archive'
  | 'unarchive'
  | 'add-tags'
  | 'remove-tags'
  | 'set-author'

type PanelKind = 'none' | 'confirm' | 'add-tags' | 'remove-tags' | 'set-author'

interface BatchActionDef {
  id: BatchActionId
  label: string
  /** 危险动作：需二次确认 */
  danger?: boolean
  /** 需要先录入内容再执行 */
  panel?: PanelKind
}

const ACTIONS: BatchActionDef[] = [
  { id: 'publish', label: '上线' },
  { id: 'unpublish', label: '下线', danger: true },
  { id: 'archive', label: '归档', danger: true },
  { id: 'unarchive', label: '取消归档' },
  { id: 'add-tags', label: '添加标签', panel: 'add-tags' },
  { id: 'remove-tags', label: '移除标签', panel: 'remove-tags' },
  { id: 'set-author', label: '修改作者', panel: 'set-author' },
]

/** 危险动作的后果说明。写清楚**会发生什么**，而不是笼统地问「确定吗」 */
const DANGER_NOTES: Partial<Record<BatchActionId, string>> = {
  unpublish:
    '下线后这些作品会立即从前台消失（前台只展示已上线作品）。数据仍保留在后台，可随时重新上线。',
  archive:
    '归档后这些作品会从默认列表与状态筛选里收起，需要切到「已归档」才看得到。归档不改发布状态，取消归档也不会自动重新上线。',
}

const {
  selectedCount,
  selectedIds,
  selectedCommonTags,
  availableAuthors,
  availableTags,
  batchSetStatus,
  batchSetArchived,
  batchAddTags,
  batchRemoveTags,
  batchSetAuthor,
  clearSelection,
} = useAdminGames()

const panel = ref<PanelKind>('none')
const pending = ref<BatchActionDef | null>(null)

const tagDraft = ref('')
const authorDraft = ref('')
const removeDraft = ref<string[]>([])

/** 逗号 / 顿号 / 空格分隔都接受，并去重去空 */
const parsedTags = computed<string[]>(() => [
  ...new Set(
    tagDraft.value
      .split(/[,，、\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
])

const removeDraftCount = computed(() => removeDraft.value.length)

function resetPanel(): void {
  panel.value = 'none'
  pending.value = null
  tagDraft.value = ''
  authorDraft.value = ''
  removeDraft.value = []
}

// 勾选被清空时（包括批量执行后自动清空）收起面板，避免留下一个悬空的面板
watch(selectedCount, (count) => {
  if (count === 0) resetPanel()
})

/* ---------------------------------------------------------------------------
   动作分发
   --------------------------------------------------------------------------- */
function onActionClick(action: BatchActionDef): void {
  resetPanel()
  if (action.panel) {
    panel.value = action.panel
    return
  }
  if (action.danger) {
    pending.value = action
    panel.value = 'confirm'
    return
  }
  void runAction(action)
}

/** 只有「无需录入、无需确认」的动作会走到这里（上线 / 取消归档）以及确认后的下线 / 归档 */
async function runAction(action: BatchActionDef): Promise<void> {
  const ids = selectedIds.value
  switch (action.id) {
    case 'publish':
      await batchSetStatus(ids, 'published')
      break
    case 'unpublish':
      await batchSetStatus(ids, 'offline')
      break
    case 'archive':
      await batchSetArchived(ids, true)
      break
    case 'unarchive':
      await batchSetArchived(ids, false)
      break
    default:
      break
  }
  resetPanel()
}

async function confirmDanger(): Promise<void> {
  const action = pending.value
  if (!action) return
  await runAction(action)
}

async function submitAddTags(): Promise<void> {
  if (parsedTags.value.length === 0) return
  await batchAddTags(selectedIds.value, parsedTags.value)
  resetPanel()
}

async function submitRemoveTags(): Promise<void> {
  if (removeDraft.value.length === 0) return
  await batchRemoveTags(selectedIds.value, removeDraft.value)
  resetPanel()
}

async function submitAuthor(): Promise<void> {
  const author = authorDraft.value.trim()
  if (!author) return
  await batchSetAuthor(selectedIds.value, author)
  resetPanel()
}

function appendTag(tag: string): void {
  if (parsedTags.value.includes(tag)) return
  tagDraft.value = [...parsedTags.value, tag].join(', ')
}

function toggleRemoveTag(tag: string): void {
  removeDraft.value = removeDraft.value.includes(tag)
    ? removeDraft.value.filter((item) => item !== tag)
    : [...removeDraft.value, tag]
}

/* ---------------------------------------------------------------------------
   样式
   --------------------------------------------------------------------------- */
const ACTION_BUTTON =
  'rounded-none border px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] ' +
  'transition-colors duration-150 ease-out'

/** 危险动作用强调红描边 —— 在只有黑白红的设计系统里，这是唯一的「警示色」 */
function actionClass(danger: boolean): string {
  return [
    ACTION_BUTTON,
    danger
      ? 'border-[#ff0000] bg-white text-[#ff0000] hover:bg-[#ff0000] hover:text-white'
      : 'border-black bg-white text-black hover:bg-black hover:text-white',
  ].join(' ')
}

const SUBMIT_CLASS =
  'rounded-none border border-black bg-black px-5 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-white transition-colors duration-150 ease-out ' +
  'hover:border-[#ff0000] hover:bg-[#ff0000] ' +
  'disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:bg-white disabled:text-black/30 ' +
  'disabled:hover:border-[#cccccc] disabled:hover:bg-white disabled:hover:text-black/30'

const GHOST_CLASS =
  'rounded-none border border-transparent px-4 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]'

const INPUT_CLASS =
  'w-full max-w-[520px] rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'

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
  <!-- ============ 未选择：一行细提示 ============ -->
  <section v-if="selectedCount === 0" class="border border-[#cccccc] px-6 py-4">
    <p class="swiss-meta text-black/45">未选择任何作品 · 勾选表格左侧复选框后可批量操作</p>
  </section>

  <!-- ============ 已选择 ============ -->
  <section v-else class="border border-black">
    <div
      class="flex flex-wrap items-center justify-between gap-4 border-b border-[#cccccc] px-6 py-4"
    >
      <p class="swiss-meta font-bold text-[#ff0000]" aria-live="polite">
        已选择 {{ selectedCount }} 项
      </p>
      <button type="button" :class="GHOST_CLASS" @click="clearSelection">取消选择</button>
    </div>

    <div class="flex flex-wrap gap-3 px-6 py-5">
      <button
        v-for="action in ACTIONS"
        :key="action.id"
        type="button"
        :class="actionClass(Boolean(action.danger))"
        @click="onActionClick(action)"
      >
        {{ action.label }}
      </button>
    </div>

    <!-- ---------- 二次确认 ---------- -->
    <div v-if="panel === 'confirm' && pending" class="border-t border-black px-6 py-5">
      <p class="swiss-meta font-bold text-[#ff0000]">
        确认执行「{{ pending.label }}」· 影响 {{ selectedCount }} 项
      </p>
      <p class="mt-3 max-w-[74ch] font-sans text-xs leading-relaxed text-black/70">
        {{ DANGER_NOTES[pending.id] }}
      </p>
      <div class="mt-5 flex flex-wrap gap-3">
        <button type="button" :class="SUBMIT_CLASS" @click="confirmDanger">确认执行</button>
        <button type="button" :class="GHOST_CLASS" @click="resetPanel">取消</button>
      </div>
    </div>

    <!-- ---------- 添加标签 ---------- -->
    <div v-if="panel === 'add-tags'" class="border-t border-black px-6 py-5">
      <label class="swiss-meta mb-3 block text-black/60" for="admin-batch-tags">
        添加标签 · 应用到 {{ selectedCount }} 项（多个标签用逗号分隔）
      </label>
      <input
        id="admin-batch-tags"
        v-model="tagDraft"
        type="text"
        autocomplete="off"
        placeholder="例如：恐怖, 剧情"
        :class="INPUT_CLASS"
        @keyup.enter="submitAddTags"
      />

      <div v-if="availableTags.length" class="mt-5">
        <p class="swiss-meta mb-3 text-black/60">快捷填入已有标签</p>
        <div class="flex flex-wrap gap-3">
          <button
            v-for="tag in availableTags"
            :key="tag"
            type="button"
            :class="chipClass(parsedTags.includes(tag))"
            :aria-pressed="parsedTags.includes(tag)"
            @click="appendTag(tag)"
          >
            {{ tag }}
          </button>
        </div>
      </div>
      <p v-else class="swiss-meta mt-4 text-black/35">
        目录中还没有任何标签，直接输入新标签名即可
      </p>

      <p v-if="parsedTags.length" class="mt-4 font-sans text-xs text-black/60">
        将添加：<span class="font-bold text-black">{{ parsedTags.join(' / ') }}</span>
      </p>

      <div class="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          :class="SUBMIT_CLASS"
          :disabled="parsedTags.length === 0"
          @click="submitAddTags"
        >
          确认添加
        </button>
        <button type="button" :class="GHOST_CLASS" @click="resetPanel">取消</button>
      </div>
    </div>

    <!-- ---------- 移除标签 ---------- -->
    <div v-if="panel === 'remove-tags'" class="border-t border-black px-6 py-5">
      <p class="swiss-meta mb-3 text-black/60">从所选 {{ selectedCount }} 项中移除标签</p>

      <template v-if="selectedCommonTags.length">
        <div class="flex flex-wrap gap-3">
          <button
            v-for="tag in selectedCommonTags"
            :key="tag"
            type="button"
            :class="chipClass(removeDraft.includes(tag))"
            :aria-pressed="removeDraft.includes(tag)"
            @click="toggleRemoveTag(tag)"
          >
            {{ tag }}
          </button>
        </div>
        <div class="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            :class="SUBMIT_CLASS"
            :disabled="removeDraftCount === 0"
            @click="submitRemoveTags"
          >
            移除选中的 {{ removeDraftCount }} 个标签
          </button>
          <button type="button" :class="GHOST_CLASS" @click="resetPanel">取消</button>
        </div>
      </template>

      <p v-else class="max-w-[74ch] font-sans text-xs leading-relaxed text-black/60">
        所选作品没有共同的标签，因此没有可批量移除的目标。只有
        <span class="font-bold text-black">所有</span>
        选中项都拥有的标签才会出现在这里 —— 否则移除操作对其中一部分就是空操作。
      </p>
    </div>

    <!-- ---------- 修改作者 ---------- -->
    <div v-if="panel === 'set-author'" class="border-t border-black px-6 py-5">
      <label class="swiss-meta mb-3 block text-black/60" for="admin-batch-author">
        修改作者 · 应用到 {{ selectedCount }} 项
      </label>
      <input
        id="admin-batch-author"
        v-model="authorDraft"
        type="text"
        autocomplete="off"
        placeholder="输入作者名"
        :class="INPUT_CLASS"
        @keyup.enter="submitAuthor"
      />

      <div class="mt-5">
        <p class="swiss-meta mb-3 text-black/60">选择现有作者</p>
        <div class="flex flex-wrap gap-3">
          <button
            v-for="author in availableAuthors"
            :key="author"
            type="button"
            :class="chipClass(authorDraft === author)"
            @click="authorDraft = author"
          >
            {{ author }}
          </button>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          :class="SUBMIT_CLASS"
          :disabled="!authorDraft.trim()"
          @click="submitAuthor"
        >
          保存修改
        </button>
        <button type="button" :class="GHOST_CLASS" @click="resetPanel">取消</button>
      </div>
    </div>
  </section>
</template>
