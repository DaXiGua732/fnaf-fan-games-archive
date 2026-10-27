<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import AdminDataState from '../../components/admin/AdminDataState.vue'
import { useAdminGames } from '../../composables/useAdminGames'
import { STORAGE_NOTICE, type StorageKind } from '../../types/admin'
import { useVocabulary, type VocabularyEntryRow } from '../../composables/useVocabulary'
import {
  VOCABULARY_COLLECTIONS,
  VOCABULARY_LABELS,
  VOCABULARY_LIMITS,
  type VocabularyCollection,
} from '../../types/taxonomy'
import { normalizeTaxonomyInput } from '../../utils/taxonomy'

/**
 * /admin/vocabulary —— 玩法类型 / 游戏机制 / 支持平台
 *
 * 三套词表共用同一套模型与同一组操作，所以页面按集合循环渲染，
 * 而不是抄三段几乎相同的表格。所有读写都经过 useVocabulary，
 * 视图层不碰仓储、也不手写目录数据的过滤。
 *
 * 安全规则（都在仓储层再校验一遍，这里只是提前给出可读反馈）：
 *   - 同集合重名 / 同 id 拒绝创建；
 *   - 跨集合同名只提示，不阻止（「解谜」可能既是玩法又是机制）；
 *   - 仍被作品引用的词条默认不能删，必须先合并或显式移除引用。
 */
const {
  sections,
  issues,
  storage,
  totalGames,
  unclassifiedGames,
  unused,
  findRow,
  otherRows,
  label,
  search,
  nameConflicts,
  createEntry,
  updateEntry,
  mergeEntries,
  deleteEntry,
} = useVocabulary()

const { dataOk } = useAdminGames()

/* ---------------------------------------------------------------------------
   搜索：每个分区一个输入框。过滤在 useVocabulary.search 里，视图不写 .filter()
   --------------------------------------------------------------------------- */
const searches = reactive<Record<VocabularyCollection, string>>({
  gameplayTypes: '',
  mechanics: '',
  platforms: '',
})

function visibleRows(collection: VocabularyCollection): VocabularyEntryRow[] {
  return search(collection, searches[collection])
}

/* ---------------------------------------------------------------------------
   新建
   --------------------------------------------------------------------------- */
interface CreateForm {
  name: string
  description: string
  id: string
  notice: string
}

const createForms = reactive<Record<VocabularyCollection, CreateForm>>({
  gameplayTypes: { name: '', description: '', id: '', notice: '' },
  mechanics: { name: '', description: '', id: '', notice: '' },
  platforms: { name: '', description: '', id: '', notice: '' },
})

const working = ref(false)
const outcome = ref<{ message: string; storage: StorageKind } | null>(null)
const failure = ref('')

function resetCreate(collection: VocabularyCollection): void {
  createForms[collection] = { name: '', description: '', id: '', notice: '' }
}

/** 跨集合同名提示（只提示，不阻止保存） */
function conflictsFor(collection: VocabularyCollection): string {
  const name = normalizeTaxonomyInput({ name: createForms[collection].name }).name
  if (!name) return ''
  const conflicts = nameConflicts(collection, name)
  if (conflicts.length === 0) return ''
  return `注意：「${name}」已经作为${conflicts
    .map((item) => `「${VOCABULARY_LABELS[item]}」`)
    .join('、')}存在。如果它确实是${label(collection)}，继续创建；否则请回到对应分区维护。`
}

async function submitCreate(collection: VocabularyCollection): Promise<void> {
  if (working.value) return
  const form = createForms[collection]
  form.notice = ''
  failure.value = ''

  const normalized = normalizeTaxonomyInput({
    name: form.name,
    description: form.description,
    id: form.id,
  })
  if (!normalized.name) {
    form.notice = `${label(collection)}名称不能为空`
    return
  }

  working.value = true
  try {
    const entry = await createEntry(collection, {
      name: normalized.name,
      description: normalized.description,
      id: normalized.id || undefined,
    })
    resetCreate(collection)
    outcome.value = {
      message: `已新建${label(collection)}「${entry.name}」`,
      storage: storage.value,
    }
  } catch (error) {
    form.notice = error instanceof Error ? error.message : '新建失败'
  } finally {
    working.value = false
  }
}

/* ---------------------------------------------------------------------------
   编辑（改名 + 改定义）
   --------------------------------------------------------------------------- */
interface EditState {
  collection: VocabularyCollection
  id: string
  name: string
  description: string
  notice: string
}

const editing = ref<EditState | null>(null)

function startEdit(collection: VocabularyCollection, row: VocabularyEntryRow): void {
  pendingDelete.value = null
  pendingMerge.value = null
  editing.value = {
    collection,
    id: row.entry.id,
    name: row.entry.name,
    description: row.entry.description,
    notice: '',
  }
}

function cancelEdit(): void {
  editing.value = null
}

async function submitEdit(): Promise<void> {
  if (working.value || !editing.value) return
  const state = editing.value
  state.notice = ''
  failure.value = ''

  const normalized = normalizeTaxonomyInput({
    name: state.name,
    description: state.description,
  })
  if (!normalized.name) {
    state.notice = `${label(state.collection)}名称不能为空`
    return
  }

  working.value = true
  try {
    const entry = await updateEntry(state.collection, state.id, {
      name: normalized.name,
      description: normalized.description,
    })
    editing.value = null
    outcome.value = {
      message: `已更新${label(state.collection)}「${entry.name}」（作品引用的是稳定标识，不会被改名影响）`,
      storage: storage.value,
    }
  } catch (error) {
    state.notice = error instanceof Error ? error.message : '保存失败'
  } finally {
    working.value = false
  }
}

/* ---------------------------------------------------------------------------
   合并
   --------------------------------------------------------------------------- */
const pendingMerge = ref<{ collection: VocabularyCollection; id: string } | null>(null)
const mergeTarget = ref('')

/** 合并目标：同一分区里除来源以外的词条 */
const mergeTargets = computed(() => {
  if (!pendingMerge.value) return []
  return otherRows(pendingMerge.value.collection, pendingMerge.value.id)
})

function openMerge(collection: VocabularyCollection, row: VocabularyEntryRow): void {
  cancelEdit()
  pendingDelete.value = null
  pendingMerge.value = { collection, id: row.entry.id }
  mergeTarget.value = mergeTargets.value[0]?.entry.id ?? ''
  failure.value = ''
}

function cancelMerge(): void {
  pendingMerge.value = null
  mergeTarget.value = ''
}

async function confirmMerge(): Promise<void> {
  if (working.value || !pendingMerge.value) return
  const { collection, id } = pendingMerge.value
  const target = mergeTarget.value
  if (!target) return

  working.value = true
  failure.value = ''
  // 名称必须在合并前取：合并完成后来源词条已经从 sections 里消失
  const sourceName = findRow(collection, id)?.entry.name ?? id
  const targetName = findRow(collection, target)?.entry.name ?? target
  try {
    const result = await mergeEntries(collection, id, target)
    cancelMerge()
    outcome.value = {
      message: `已把「${sourceName}」合并到「${targetName}」，同时改写 ${result.affectedGames} 款作品的引用`,
      storage: storage.value,
    }
  } catch (error) {
    failure.value = error instanceof Error ? error.message : '合并失败'
  } finally {
    working.value = false
  }
}

/* ---------------------------------------------------------------------------
   删除（被引用时必须先合并，或显式从作品移除）
   --------------------------------------------------------------------------- */
const pendingDelete = ref<{ collection: VocabularyCollection; id: string } | null>(null)
const deleteNotice = ref('')

function openDelete(collection: VocabularyCollection, row: VocabularyEntryRow): void {
  cancelEdit()
  cancelMerge()
  pendingDelete.value = { collection, id: row.entry.id }
  deleteNotice.value = ''
}

function cancelDelete(): void {
  pendingDelete.value = null
  deleteNotice.value = ''
}

const pendingDeleteRow = computed(() => {
  if (!pendingDelete.value) return null
  const { collection, id } = pendingDelete.value
  return findRow(collection, id) ?? null
})

async function confirmDelete(removeFromGames: boolean): Promise<void> {
  if (working.value || !pendingDelete.value) return
  const { collection, id } = pendingDelete.value
  const row = pendingDeleteRow.value
  working.value = true
  deleteNotice.value = ''
  failure.value = ''
  try {
    const result = await deleteEntry(collection, id, { removeFromGames })
    cancelDelete()
    outcome.value = {
      message: `已删除${label(collection)}「${row?.entry.name ?? id}」${
        result.affectedGames > 0 ? `，并从 ${result.affectedGames} 款作品上移除` : ''
      }`,
      storage: storage.value,
    }
  } catch (error) {
    deleteNotice.value = error instanceof Error ? error.message : '删除失败'
  } finally {
    working.value = false
  }
}
/** 删除确认里改走合并：先关掉删除面板，再用同一行打开合并面板 */
function switchToMerge(): void {
  const row = pendingDeleteRow.value
  if (!row || !pendingDelete.value) return
  const collection = pendingDelete.value.collection
  cancelDelete()
  openMerge(collection, row)
}

/* ---------------------------------------------------------------------------
   样式（与标签 / 作者页保持同一套直角语言）
   --------------------------------------------------------------------------- */
const SMALL_BUTTON =
  'rounded-none border border-black bg-white px-4 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30'

const DANGER_BUTTON =
  'rounded-none border border-accent bg-white px-4 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-accent transition-colors duration-150 ease-out hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent disabled:cursor-not-allowed disabled:border-line disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30'

const GHOST_CLASS =
  'rounded-none border border-transparent px-2 py-1 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-black/60 transition-colors duration-150 ease-out hover:text-accent disabled:cursor-not-allowed disabled:text-black/25'

const SEARCH_INPUT =
  'min-w-[220px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-accent focus:outline-none'

const FIELD_INPUT =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-accent focus:outline-none'

const SECTION_META: Record<VocabularyCollection, { index: string; title: string; hint: string }> = {
  gameplayTypes: {
    index: '02.2.1',
    title: '玩法类型',
    hint: '回答「核心游玩循环是什么」。第一项是作品的主要玩法，最多 3 个，用于表达混合玩法。',
  },
  mechanics: {
    index: '02.2.2',
    title: '游戏机制',
    hint: '回答「玩家具体做什么」：监控摄像头、资源管理、潜行、解谜等。机制不能反推玩法类型。',
  },
  platforms: {
    index: '02.2.3',
    title: '支持平台',
    hint: '作品实际支持的运行平台。改名不会影响已引用它的作品。',
  },
}
</script>

<template>
  <AdminDataState v-if="!dataOk" />

  <div v-else class="py-12 md:py-16">
    <!-- ============ 页头 ============ -->
    <div class="flex flex-wrap items-end justify-between gap-6 border-b border-black pb-6">
      <div>
        <p class="swiss-meta mb-3 text-black/60">02 — Taxonomy</p>
        <h1 class="font-sans text-2xl font-bold uppercase tracking-tight md:text-3xl">
          玩法与机制
        </h1>
      </div>
      <div class="flex flex-wrap items-center gap-6">
        <p class="swiss-meta text-black/50">
          未标玩法 {{ unclassifiedGames }} / {{ totalGames }} 款
        </p>
      </div>
    </div>

    <p class="mt-8 max-w-[78ch] font-sans text-sm leading-relaxed text-black/60">
      这里是受控词表：作品引用的是每个词条的<span class="font-bold text-black">稳定标识</span>，
      所以改名不会漏掉任何作品；合并与删除会在同一次提交里改写所有引用。
      这里只建立分类，<span class="font-bold text-black">不会自动给任何作品打标签</span> ——
      玩法与机制必须由管理员按资料手工标注。
    </p>

    <!-- ============ 词表结构问题 ============ -->
    <div v-if="issues.length" class="mt-8 border border-accent px-6 py-5" role="alert">
      <p class="swiss-meta font-bold text-accent">数据里的词表有问题</p>
      <ul class="mt-3 space-y-2">
        <li v-for="issue in issues" :key="issue" class="font-sans text-xs leading-relaxed text-black/70">
          {{ issue }}
        </li>
      </ul>
      <p class="mt-3 font-sans text-xs leading-relaxed text-black/50">
        这些问题只影响读取；在上面新建 / 编辑词条会以当前合法条目为基础重新写入。
      </p>
    </div>

    <!-- ============ 操作结果 ============ -->
    <div
      v-if="outcome"
      class="mt-8 border border-line border-l-4 border-l-accent px-6 py-5"
      role="status"
      aria-live="polite"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="swiss-meta text-black/60">操作结果</p>
          <p class="mt-2 font-sans text-sm font-bold">{{ outcome.message }}</p>
          <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/60">
            {{ STORAGE_NOTICE[outcome.storage] }}
          </p>
        </div>
        <button type="button" :class="GHOST_CLASS" @click="outcome = null">关闭</button>
      </div>
    </div>

    <div v-if="failure" class="mt-8 border border-accent px-6 py-5" role="alert">
      <p class="swiss-meta font-bold text-accent">操作失败</p>
      <p class="mt-2 font-sans text-xs leading-relaxed text-black/70">{{ failure }}</p>
    </div>

    <!-- ============ 三个分区 ============ -->
    <section
      v-for="collection in VOCABULARY_COLLECTIONS"
      :id="`vocab-${collection}`"
      :key="collection"
      class="mt-14 scroll-mt-40"
      :aria-labelledby="`vocab-${collection}-title`"
    >
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-4">
        <div>
          <p class="swiss-meta mb-3 text-black/60">
            {{ SECTION_META[collection].index }} — {{ collection }}
          </p>
          <h2
            :id="`vocab-${collection}-title`"
            class="font-sans text-xl font-bold uppercase tracking-tight"
          >
            {{ SECTION_META[collection].title }}
          </h2>
        </div>
        <p class="swiss-meta text-black/50">
          共 {{ sections[collection].length }} 个 · 未使用 {{ unused[collection] }} 个
        </p>
      </div>

      <p class="mt-4 max-w-[78ch] font-sans text-xs leading-relaxed text-black/55">
        {{ SECTION_META[collection].hint }}
      </p>

      <!-- 新建 -->
      <form
        class="mt-6 border border-black p-6 md:p-8"
        @submit.prevent="submitCreate(collection)"
      >
        <p class="swiss-meta mb-4 text-black/60">新建{{ label(collection) }}</p>
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.8fr)]">
          <div>
            <label class="swiss-meta mb-2 block text-black/60" :for="`vocab-${collection}-name`">
              名称
            </label>
            <input
              :id="`vocab-${collection}-name`"
              v-model="createForms[collection].name"
              type="text"
              autocomplete="off"
              :maxlength="VOCABULARY_LIMITS.nameMax"
              placeholder="显示名称"
              :class="FIELD_INPUT"
            />
          </div>
          <div>
            <label class="swiss-meta mb-2 block text-black/60" :for="`vocab-${collection}-desc`">
              简短定义（选填）
            </label>
            <input
              :id="`vocab-${collection}-desc`"
              v-model="createForms[collection].description"
              type="text"
              autocomplete="off"
              :maxlength="VOCABULARY_LIMITS.descriptionMax"
              placeholder="帮助判断哪些作品该归入这一类"
              :class="FIELD_INPUT"
            />
          </div>
          <div>
            <label class="swiss-meta mb-2 block text-black/60" :for="`vocab-${collection}-id`">
              稳定标识（选填）
            </label>
            <input
              :id="`vocab-${collection}-id`"
              v-model="createForms[collection].id"
              type="text"
              autocomplete="off"
              :maxlength="VOCABULARY_LIMITS.idMax"
              placeholder="留空自动生成"
              :class="FIELD_INPUT"
            />
          </div>
        </div>

        <p
          v-if="conflictsFor(collection)"
          class="mt-4 max-w-[78ch] font-sans text-xs leading-relaxed text-black/60"
        >
          {{ conflictsFor(collection) }}
        </p>
        <p
          v-if="createForms[collection].notice"
          class="mt-3 font-sans text-xs text-accent"
          role="alert"
        >
          {{ createForms[collection].notice }}
        </p>

        <div class="mt-5 flex flex-wrap gap-3">
          <button
            type="submit"
            :class="SMALL_BUTTON"
            :disabled="working || !createForms[collection].name.trim()"
          >
            新建
          </button>
          <button type="button" :class="GHOST_CLASS" @click="resetCreate(collection)">
            清空
          </button>
        </div>
      </form>

      <!-- 搜索 -->
      <div class="mt-6 flex flex-wrap items-stretch gap-3">
        <label class="sr-only" :for="`vocab-${collection}-search`">
          搜索{{ label(collection) }}
        </label>
        <input
          :id="`vocab-${collection}-search`"
          v-model="searches[collection]"
          type="search"
          autocomplete="off"
          :placeholder="`输入${label}名称或定义…`"
          :class="SEARCH_INPUT"
        />
        <button
          type="button"
          :class="SMALL_BUTTON"
          :disabled="searches[collection].trim() === ''"
          @click="searches[collection] = ''"
        >
          清除
        </button>
      </div>

      <!-- 合并 / 删除确认（页内，不用原生弹窗） -->
      <div
        v-if="pendingMerge && pendingMerge.collection === collection"
        class="mt-6 border border-black px-6 py-5"
        role="alert"
        aria-live="assertive"
      >
        <p class="swiss-meta font-bold">
          合并{{ label(collection) }}「{{
            findRow(collection, pendingMerge?.id ?? '')?.entry.name
          }}」
        </p>
        <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
          来源词条会被删除，所有引用它的作品都会改成目标词条（去重后）。这个操作会同时改动多条作品。
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <select
            v-model="mergeTarget"
            class="rounded-none border border-black bg-white px-4 py-2 font-sans text-sm focus:border-accent focus:outline-none"
            aria-label="选择合并目标"
          >
            <option v-for="row in mergeTargets" :key="row.entry.id" :value="row.entry.id">
              {{ row.entry.name }}
            </option>
          </select>
          <button
            type="button"
            :class="SMALL_BUTTON"
            :disabled="working || !mergeTarget"
            @click="confirmMerge"
          >
            确认合并
          </button>
          <button type="button" :class="GHOST_CLASS" :disabled="working" @click="cancelMerge">
            取消
          </button>
        </div>
      </div>

      <div
        v-if="pendingDelete && pendingDelete.collection === collection && pendingDeleteRow"
        class="mt-6 border border-accent px-6 py-5"
        role="alert"
        aria-live="assertive"
      >
        <p class="swiss-meta font-bold text-accent">
          删除{{ label(collection) }}「{{ pendingDeleteRow.entry.name }}」？
        </p>
        <p
          v-if="pendingDeleteRow.all > 0"
          class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70"
        >
          仍被 {{ pendingDeleteRow.all }} 款作品使用（前台可见 {{ pendingDeleteRow.visible }}）。
          默认不能直接删除：请先合并到其他词条，或选择「从作品移除并删除」——
          后者会同时改动这 {{ pendingDeleteRow.all }} 款作品。
        </p>
        <p v-else class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
          这个{{ label(collection) }}没有被任何作品使用，可以安全删除。
        </p>
        <p v-if="deleteNotice" class="mt-2 font-sans text-xs text-accent" role="alert">
          {{ deleteNotice }}
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          <button
            v-if="pendingDeleteRow.all === 0"
            type="button"
            :class="DANGER_BUTTON"
            :disabled="working"
            @click="confirmDelete(false)"
          >
            确认删除
          </button>
          <button
            v-else
            type="button"
            :class="DANGER_BUTTON"
            :disabled="working"
            @click="confirmDelete(true)"
          >
            从作品移除并删除
          </button>
          <button
            v-if="pendingDeleteRow.all > 0"
            type="button"
            :class="SMALL_BUTTON"
            :disabled="working"
            @click="switchToMerge"
          >
            改为合并
          </button>
          <button type="button" :class="GHOST_CLASS" :disabled="working" @click="cancelDelete">
            取消
          </button>
        </div>
      </div>

      <!-- 列表 -->
      <p class="swiss-meta mb-4 mt-8 text-black/60">
        {{ label(collection) }}列表 · 找到 {{ visibleRows(collection).length }} /
        {{ sections[collection].length }}
      </p>

      <div class="overflow-x-auto border border-black">
        <table class="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr class="border-b border-black">
              <th class="border-r border-line px-4 py-4 align-middle">
                <span class="swiss-meta font-normal text-black/60">名称 / 定义</span>
              </th>
              <th class="w-[150px] border-r border-line px-4 py-4 text-right align-middle">
                <span class="swiss-meta font-normal text-black/60">使用数量</span>
              </th>
              <th class="w-[190px] px-4 py-4 align-middle">
                <span class="swiss-meta font-normal text-black/60">操作</span>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="row in visibleRows(collection)"
              :key="row.entry.id"
              class="border-b border-line transition-colors duration-150 ease-out last:border-b-0 hover:bg-surface"
            >
              <td class="border-r border-line px-4 py-4 align-middle">
                <template
                  v-if="editing && editing.collection === collection && editing.id === row.entry.id"
                >
                  <div class="flex flex-col gap-3">
                    <input
                      v-model="editing.name"
                      type="text"
                      autocomplete="off"
                      :maxlength="VOCABULARY_LIMITS.nameMax"
                      :class="FIELD_INPUT"
                      :aria-label="`${label(collection)}名称`"
                    />
                    <input
                      v-model="editing.description"
                      type="text"
                      autocomplete="off"
                      :maxlength="VOCABULARY_LIMITS.descriptionMax"
                      placeholder="简短定义（选填）"
                      :class="FIELD_INPUT"
                      :aria-label="`${label(collection)}定义`"
                    />
                    <p v-if="editing.notice" class="font-sans text-xs text-accent" role="alert">
                      {{ editing.notice }}
                    </p>
                    <div class="flex flex-wrap gap-3">
                      <button
                        type="button"
                        :class="SMALL_BUTTON"
                        :disabled="working"
                        @click="submitEdit"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        :class="GHOST_CLASS"
                        :disabled="working"
                        @click="cancelEdit"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <p class="font-sans text-sm font-bold">{{ row.entry.name }}</p>
                  <p class="mt-1 font-sans text-xs leading-relaxed text-black/50">
                    {{ row.entry.description || '（没有填写定义）' }}
                  </p>
                  <p class="mt-1 font-mono text-[10px] tracking-[0.06em] text-black/35">
                    {{ row.entry.id }}
                  </p>
                </template>
              </td>

              <td class="border-r border-line px-4 py-4 text-right align-middle">
                <p class="font-sans text-xs tabular-nums">{{ row.all }} 款</p>
                <p class="mt-1 font-sans text-[11px] tabular-nums text-black/45">
                  前台可见 {{ row.visible }}
                </p>
              </td>

              <td class="px-4 py-4 align-middle">
                <div class="flex flex-col items-start gap-2">
                  <button
                    type="button"
                    class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-accent"
                    @click="startEdit(collection, row)"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-accent disabled:cursor-not-allowed disabled:text-black/25"
                    :disabled="sections[collection].length < 2"
                    @click="openMerge(collection, row)"
                  >
                    合并
                  </button>
                  <button
                    type="button"
                    class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-accent transition-colors duration-150 ease-out hover:text-black"
                    @click="openDelete(collection, row)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>

            <tr v-if="visibleRows(collection).length === 0">
              <td colspan="3" class="px-6 py-16 md:px-8 md:py-20">
                <p class="font-sans text-xl font-bold uppercase tracking-tight">No Results</p>
                <p class="mt-4 max-w-[60ch] font-sans text-sm leading-relaxed text-black/60">
                  {{
                    sections[collection].length === 0
                      ? `还没有任何${label(collection)}。用上面的表单新建第一个。`
                      : '没有匹配的词条，换个关键词试试。'
                  }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
