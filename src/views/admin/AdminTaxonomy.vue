<script setup lang="ts">
import { computed, ref } from 'vue'
import AdminDataState from '../../components/admin/AdminDataState.vue'
import { DRAFT_LIMITS } from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { useSearchField } from '../../composables/useSearchField'
import { STORAGE_NOTICE, TAG_LIMITS, normalizeTag } from '../../types/admin'
import { formatTimestamp } from '../../utils/datetime'

/**
 * /admin/taxonomy —— 标签与作者合并管理
 *
 * 两者本质相同：都不是独立表，而是**挂在作品上的字符串**。
 * 所以本页不引入任何新的数据层，只调用 useAdminGames 里已经收口的
 * renameTag / deleteTag / renameAuthor。视图层不做 .filter() / .sort()。
 *
 * 标签可以删除（只摘掉字符串）；作者是必填字段，只能改名 / 合并，不能删。
 */
const {
  allTags,
  visibleTags,
  tagSearch,
  setTagSearch,
  clearTagSearch,
  findTag,
  renameTag,
  deleteTag,
  allAuthors,
  visibleAuthors,
  authorSearch,
  setAuthorSearch,
  clearAuthorSearch,
  findAuthor,
  renameAuthor,
  lastOutcome,
  dataOk,
  dismissOutcome,
} = useAdminGames()

/** 见 composables/useSearchField.ts：受控输入的回写会让反向选中后打字变成倒序 */
const tagSearchText = useSearchField(computed(() => tagSearch.value), setTagSearch)
const authorSearchText = useSearchField(computed(() => authorSearch.value), setAuthorSearch)

/* ---------------------------------------------------------------------------
   行内状态
   两套「编辑中 / 待删除」互相排斥：同时只允许一行处于操作中。
   --------------------------------------------------------------------------- */
const editingTag = ref('')
const tagRenameDraft = ref('')
const tagRenameNotice = ref('')
const pendingDeleteTag = ref('')

const editingAuthor = ref('')
const authorRenameDraft = ref('')
const authorRenameNotice = ref('')

/** 正在提交，避免双击产生两次提交 */
const working = ref(false)

/** 归一化预览：让用户在提交前就看到实际会写入什么（例如多余的空格会被压掉） */
const tagRenamePreview = computed(() => normalizeTag(tagRenameDraft.value))
const authorRenamePreview = computed(() => authorRenameDraft.value.trim())

function cancelTagRename(): void {
  editingTag.value = ''
  tagRenameDraft.value = ''
  tagRenameNotice.value = ''
}

function startTagRename(tag: string): void {
  cancelAuthorRename()
  pendingDeleteTag.value = ''
  editingTag.value = tag
  tagRenameDraft.value = tag
  tagRenameNotice.value = ''
}

async function submitTagRename(): Promise<void> {
  if (working.value) return
  const next = tagRenamePreview.value
  if (!next) {
    tagRenameNotice.value = '标签名不能为空'
    return
  }
  if (next === editingTag.value) {
    cancelTagRename()
    return
  }
  working.value = true
  try {
    await renameTag(editingTag.value, next)
    cancelTagRename()
  } finally {
    working.value = false
  }
}

function startDeleteTag(tag: string): void {
  cancelTagRename()
  cancelAuthorRename()
  pendingDeleteTag.value = tag
}

/** 待删除标签当前的使用次数 —— 确认文案里要说清会影响多少条作品 */
const pendingDeleteUsage = computed(() => findTag(pendingDeleteTag.value)?.usage ?? 0)

async function confirmDeleteTag(): Promise<void> {
  if (working.value) return
  const tag = pendingDeleteTag.value
  pendingDeleteTag.value = ''
  if (!tag) return
  working.value = true
  try {
    await deleteTag(tag)
  } finally {
    working.value = false
  }
}

function cancelAuthorRename(): void {
  editingAuthor.value = ''
  authorRenameDraft.value = ''
  authorRenameNotice.value = ''
}

function startAuthorRename(author: string): void {
  cancelTagRename()
  pendingDeleteTag.value = ''
  editingAuthor.value = author
  authorRenameDraft.value = author
  authorRenameNotice.value = ''
}

async function submitAuthorRename(): Promise<void> {
  if (working.value) return
  const next = authorRenamePreview.value
  if (!next) {
    authorRenameNotice.value = '作者名不能为空'
    return
  }
  if (next === editingAuthor.value) {
    cancelAuthorRename()
    return
  }
  if (next.length > DRAFT_LIMITS.author) {
    authorRenameNotice.value = `作者名不能超过 ${DRAFT_LIMITS.author} 个字符`
    return
  }
  working.value = true
  try {
    await renameAuthor(editingAuthor.value, next)
    cancelAuthorRename()
  } finally {
    working.value = false
  }
}

/** 重命名作者会影响多少条作品（提交前提示用） */
const editingAuthorUsage = computed(() => findAuthor(editingAuthor.value)?.usage ?? 0)

/* ---------------------------------------------------------------------------
   样式
   --------------------------------------------------------------------------- */
const GHOST_CLASS =
  'rounded-none border border-transparent px-2 py-1 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000] disabled:cursor-not-allowed disabled:text-black/25'

const SMALL_BUTTON =
  'rounded-none border border-black bg-white px-4 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30'

const DANGER_BUTTON =
  'rounded-none border border-[#ff0000] bg-white px-4 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-[#ff0000] transition-colors duration-150 ease-out hover:bg-[#ff0000] hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30'

const SEARCH_INPUT =
  'min-w-[240px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'

const RENAME_INPUT =
  'min-w-[180px] rounded-none border border-black bg-white px-3 py-2 font-sans text-sm ' +
  'focus:border-[#ff0000] focus:outline-none'
</script>

<template>
  <AdminDataState v-if="!dataOk" />

  <!-- 数据未就绪时不渲染内容：加载中显示空列表、出错显示空列表，都会让人以为数据没了 -->
  <div v-else class="py-12 md:py-16">
    <!-- ============ 页头 ============ -->
    <div class="flex flex-wrap items-end justify-between gap-6 border-b border-black pb-6">
      <div>
        <p class="swiss-meta mb-4 text-black/60">02 — Taxonomy</p>
        <h1 class="font-sans text-2xl font-bold uppercase tracking-tight md:text-3xl">标签与作者</h1>
        <p class="swiss-meta mt-3 text-black/50">
          共 {{ allTags.length }} 个标签 · {{ allAuthors.length }} 位作者
        </p>
      </div>
    </div>

    <p class="mt-8 max-w-[78ch] font-sans text-sm leading-relaxed text-black/60">
      标签和作者都不是独立的表，而是挂在每条作品上的字符串。
      因此「重命名」的本质是<span class="font-bold text-black">改掉所有引用它的作品</span>；
      作者是必填字段，只能改名或合并，没有删除。
    </p>

    <!-- ============ 数据现状 ============ -->
    <div class="mt-8 border border-[#cccccc] border-l-4 border-l-black px-6 py-5">
      <p class="swiss-meta text-black/60">数据现状</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        数据源里的标签<span class="font-bold text-black">没有独立存储，也没有创建时间</span>。
        「创建时间」列只记录本次会话中由后台首次引入的标签，其余显示「—」——
        不为了填满一列而伪造日期。
      </p>
    </div>

    <!-- ============ 操作结果 ============ -->
    <div
      v-if="lastOutcome"
      class="mt-8 border border-[#cccccc] border-l-4 border-l-[#ff0000] px-6 py-5"
      role="status"
      aria-live="polite"
    >
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="swiss-meta text-black/60">操作结果</p>
          <p class="mt-2 font-sans text-sm font-bold">
            {{ lastOutcome.label }} —— 影响了 {{ lastOutcome.changed }} 条作品<template
              v-if="lastOutcome.failed > 0"
            >
              ，<span class="text-[#ff0000]">失败 {{ lastOutcome.failed }} 条</span></template
            >
          </p>
          <p
            v-if="lastOutcome.failed > 0 && lastOutcome.error"
            class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-[#ff0000]"
          >
            失败原因：{{ lastOutcome.error }}
          </p>
          <p class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
            {{ STORAGE_NOTICE[lastOutcome.storage] }}
          </p>
        </div>
        <button type="button" :class="GHOST_CLASS" @click="dismissOutcome">知道了</button>
      </div>
    </div>

    <!-- ============ 标签 ============ -->
    <section class="mt-12" aria-labelledby="tag-section-title">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-4">
        <div>
          <p class="swiss-meta mb-3 text-black/60">02.1 — Tags</p>
          <h2 id="tag-section-title" class="font-sans text-xl font-bold uppercase tracking-tight">
            标签
          </h2>
        </div>
        <p class="swiss-meta text-black/50">共 {{ allTags.length }} 个</p>
      </div>

      <!-- 删除确认（页内，不用原生弹窗） -->
      <div
        v-if="pendingDeleteTag"
        class="mt-6 border border-[#ff0000] px-6 py-5"
        role="alert"
        aria-live="assertive"
      >
        <p class="swiss-meta font-bold text-[#ff0000]">确认删除标签「{{ pendingDeleteTag }}」？</p>
        <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
          该标签当前被 {{ pendingDeleteUsage }} 款作品使用，删除后会从这些作品上一并摘掉。
          作品本身不会被删除，但 <span class="font-bold text-black">这个操作影响多条记录</span>。
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          <button type="button" :class="DANGER_BUTTON" :disabled="working" @click="confirmDeleteTag">
            确认删除
          </button>
          <button type="button" :class="SMALL_BUTTON" :disabled="working" @click="pendingDeleteTag = ''">
            取消
          </button>
        </div>
      </div>

      <!-- 搜索 -->
      <div class="mt-6 border border-black p-6 md:p-8">
        <label class="swiss-meta mb-3 block text-black/60" for="tag-search">标签关键词搜索</label>
        <div class="flex flex-wrap items-stretch gap-3">
          <input
            id="tag-search"
            v-model="tagSearchText"
            type="search"
            autocomplete="off"
            placeholder="输入标签名…"
            :class="SEARCH_INPUT"
          />
          <button
            type="button"
            class="rounded-none border border-black px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
            :disabled="tagSearch.trim() === ''"
            @click="clearTagSearch"
          >
            清除
          </button>
        </div>
      </div>

      <p class="swiss-meta mb-4 mt-8 text-black/60">
        标签列表 · 命中 {{ visibleTags.length }} / {{ allTags.length }}
      </p>

      <div class="overflow-x-auto border border-black">
        <table class="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr class="border-b border-black">
              <th class="border-r border-[#cccccc] px-4 py-4 align-middle">
                <span class="swiss-meta font-normal text-black/60">标签名称</span>
              </th>
              <th class="w-[130px] border-r border-[#cccccc] px-4 py-4 text-right align-middle">
                <span class="swiss-meta font-normal text-black/60">使用数量</span>
              </th>
              <th class="w-[180px] border-r border-[#cccccc] px-4 py-4 text-right align-middle">
                <span class="swiss-meta font-normal text-black/60">创建时间</span>
              </th>
              <th class="w-[150px] px-4 py-4 align-middle">
                <span class="swiss-meta font-normal text-black/60">操作</span>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="tag in visibleTags"
              :key="tag.name"
              class="border-b border-[#cccccc] transition-colors duration-150 ease-out last:border-b-0 hover:bg-[#f9f9f9]"
            >
              <td class="border-r border-[#cccccc] px-4 py-4 align-middle">
                <template v-if="editingTag === tag.name">
                  <div class="flex flex-wrap items-center gap-3">
                    <input
                      v-model="tagRenameDraft"
                      type="text"
                      autocomplete="off"
                      :maxlength="TAG_LIMITS.maxLength"
                      :class="RENAME_INPUT"
                      @keyup.enter="submitTagRename"
                    />
                    <button type="button" :class="SMALL_BUTTON" :disabled="working" @click="submitTagRename">
                      保存
                    </button>
                    <button type="button" :class="GHOST_CLASS" :disabled="working" @click="cancelTagRename">
                      取消
                    </button>
                  </div>
                  <p v-if="tagRenameNotice" class="mt-2 font-sans text-xs text-[#ff0000]" role="alert">
                    {{ tagRenameNotice }}
                  </p>
                  <p
                    v-else-if="tagRenamePreview && tagRenamePreview !== tag.name"
                    class="mt-2 font-sans text-xs text-black/50"
                  >
                    将重命名为「{{ tagRenamePreview }}」，并同步更新所有使用它的作品
                  </p>
                </template>

                <span v-else class="font-sans text-sm font-bold">{{ tag.name }}</span>
              </td>

              <td class="border-r border-[#cccccc] px-4 py-4 text-right align-middle">
                <span class="font-sans text-xs tabular-nums">{{ tag.usage }} 款</span>
              </td>

              <td class="border-r border-[#cccccc] px-4 py-4 text-right align-middle">
                <span class="font-sans text-xs tabular-nums text-black/70">
                  {{ formatTimestamp(tag.createdAt) }}
                </span>
              </td>

              <td class="px-4 py-4 align-middle">
                <div class="flex flex-col items-start gap-2">
                  <button
                    type="button"
                    class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-[#ff0000]"
                    @click="startTagRename(tag.name)"
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-[#ff0000] transition-colors duration-150 ease-out hover:text-black"
                    @click="startDeleteTag(tag.name)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>

            <tr v-if="visibleTags.length === 0">
              <td colspan="4" class="px-6 py-20 md:px-8 md:py-24">
                <p class="font-sans text-xl font-bold uppercase tracking-tight">No Results</p>
                <p class="mt-5 max-w-[56ch] font-sans text-sm leading-relaxed text-black/60">
                  {{
                    allTags.length === 0
                      ? '目录中还没有任何标签。到作品编辑页的「标签」区块添加即可。'
                      : '没有匹配的标签，换个关键词试试。'
                  }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ============ 作者 ============ -->
    <section class="mt-16" aria-labelledby="author-section-title">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-4">
        <div>
          <p class="swiss-meta mb-3 text-black/60">02.2 — Authors</p>
          <h2 id="author-section-title" class="font-sans text-xl font-bold uppercase tracking-tight">
            作者
          </h2>
        </div>
        <p class="swiss-meta text-black/50">共 {{ allAuthors.length }} 位</p>
      </div>

      <p class="mt-6 max-w-[78ch] font-sans text-sm leading-relaxed text-black/60">
        作者是作品的必填字段，所以没有删除操作。重命名会同时改掉所有使用该名字的作品；
        输入一个已存在的名字就是合并。
      </p>

      <!-- 搜索 -->
      <div class="mt-6 border border-black p-6 md:p-8">
        <label class="swiss-meta mb-3 block text-black/60" for="author-search">作者关键词搜索</label>
        <div class="flex flex-wrap items-stretch gap-3">
          <input
            id="author-search"
            v-model="authorSearchText"
            type="search"
            autocomplete="off"
            placeholder="输入作者名…"
            :class="SEARCH_INPUT"
          />
          <button
            type="button"
            class="rounded-none border border-black px-6 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
            :disabled="authorSearch.trim() === ''"
            @click="clearAuthorSearch"
          >
            清除
          </button>
        </div>
      </div>

      <p class="swiss-meta mb-4 mt-8 text-black/60">
        作者列表 · 命中 {{ visibleAuthors.length }} / {{ allAuthors.length }}
      </p>

      <div class="overflow-x-auto border border-black">
        <table class="w-full min-w-[620px] border-collapse text-left">
          <thead>
            <tr class="border-b border-black">
              <th class="border-r border-[#cccccc] px-4 py-4 align-middle">
                <span class="swiss-meta font-normal text-black/60">作者名称</span>
              </th>
              <th class="w-[150px] border-r border-[#cccccc] px-4 py-4 text-right align-middle">
                <span class="swiss-meta font-normal text-black/60">使用数量</span>
              </th>
              <th class="w-[150px] px-4 py-4 align-middle">
                <span class="swiss-meta font-normal text-black/60">操作</span>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="author in visibleAuthors"
              :key="author.name"
              class="border-b border-[#cccccc] transition-colors duration-150 ease-out last:border-b-0 hover:bg-[#f9f9f9]"
            >
              <td class="border-r border-[#cccccc] px-4 py-4 align-middle">
                <template v-if="editingAuthor === author.name">
                  <div class="flex flex-wrap items-center gap-3">
                    <input
                      v-model="authorRenameDraft"
                      type="text"
                      autocomplete="off"
                      :maxlength="DRAFT_LIMITS.author"
                      :class="RENAME_INPUT"
                      @keyup.enter="submitAuthorRename"
                    />
                    <button
                      type="button"
                      :class="SMALL_BUTTON"
                      :disabled="working"
                      @click="submitAuthorRename"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      :class="GHOST_CLASS"
                      :disabled="working"
                      @click="cancelAuthorRename"
                    >
                      取消
                    </button>
                  </div>
                  <p v-if="authorRenameNotice" class="mt-2 font-sans text-xs text-[#ff0000]" role="alert">
                    {{ authorRenameNotice }}
                  </p>
                  <p
                    v-else-if="authorRenamePreview && authorRenamePreview !== author.name"
                    class="mt-2 font-sans text-xs text-black/50"
                  >
                    将改名为「{{ authorRenamePreview }}」，影响 {{ editingAuthorUsage }} 款作品；
                    若已存在同名作者则合并。
                  </p>
                </template>

                <span v-else class="font-sans text-sm font-bold">{{ author.name }}</span>
              </td>

              <td class="border-r border-[#cccccc] px-4 py-4 text-right align-middle">
                <span class="font-sans text-xs tabular-nums">{{ author.usage }} 款</span>
              </td>

              <td class="px-4 py-4 align-middle">
                <button
                  type="button"
                  class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-[#ff0000]"
                  @click="startAuthorRename(author.name)"
                >
                  重命名
                </button>
              </td>
            </tr>

            <tr v-if="visibleAuthors.length === 0">
              <td colspan="3" class="px-6 py-20 md:px-8 md:py-24">
                <p class="font-sans text-xl font-bold uppercase tracking-tight">No Results</p>
                <p class="mt-5 max-w-[56ch] font-sans text-sm leading-relaxed text-black/60">
                  {{ allAuthors.length === 0 ? '目录中还没有任何作者。' : '没有匹配的作者，换个关键词试试。' }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
