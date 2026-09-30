<script setup lang="ts">
import { useSearchField } from '../../composables/useSearchField'
import { computed, ref } from 'vue'
import AdminDataState from '../../components/admin/AdminDataState.vue'
import { useAdminGames } from '../../composables/useAdminGames'
import { STORAGE_NOTICE, TAG_LIMITS, normalizeTag } from '../../types/admin'
import { formatTimestamp } from '../../utils/datetime'

/**
 * /admin/tags —— 全局标签管理（Phase 6）
 *
 * 标签没有独立存储：它只是各条作品上的字符串数组。
 * 因此「重命名 / 删除标签」的本质是**改所有引用它的作品**，这两件事由深模块
 * useAdminGames 的 renameTag / deleteTag 完成，本页不含任何 .filter() / .sort()。
 *
 * 删除用**页内确认条**而不是 `window.confirm`：内嵌 webview 里原生弹窗可能被静默拦截，
 * 用户只会看到「点了没反应」。
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
  lastOutcome,
  dataOk,
  dismissOutcome,
} = useAdminGames()

/** 见 composables/useSearchField.ts：受控输入的回写会让反向选中后打字变成倒序 */
const searchText = useSearchField(computed(() => tagSearch.value), setTagSearch)

/* ---------------------------------------------------------------------------
   行内状态
   重命名是行内编辑、删除是页内确认，两者互斥 —— 同时只允许一行处于「操作中」。
   --------------------------------------------------------------------------- */
const editingTag = ref('')
const renameDraft = ref('')
const renameNotice = ref('')
const pendingDelete = ref('')

/** 归一化预览：让用户在提交前就看到实际会写入什么（例如多余的空格会被压掉） */
const renamePreview = computed(() => normalizeTag(renameDraft.value))

function startRename(tag: string): void {
  pendingDelete.value = ''
  editingTag.value = tag
  renameDraft.value = tag
  renameNotice.value = ''
}

function cancelRename(): void {
  editingTag.value = ''
  renameDraft.value = ''
  renameNotice.value = ''
}

async function submitRename(): Promise<void> {
  const next = renamePreview.value
  if (!next) {
    renameNotice.value = '标签名不能为空'
    return
  }
  // 改成同名视为放弃，不产生一次无意义的结果提示
  if (next === editingTag.value) {
    cancelRename()
    return
  }
  await renameTag(editingTag.value, next)
  cancelRename()
}

/* ---------------------------------------------------------------------------
   删除（页内确认）
   --------------------------------------------------------------------------- */
function startDelete(tag: string): void {
  cancelRename()
  pendingDelete.value = tag
}

/** 待删除标签当前的使用次数 —— 确认文案里要说清会影响多少条作品 */
const pendingDeleteUsage = computed(() => findTag(pendingDelete.value)?.usage ?? 0)

async function confirmDelete(): Promise<void> {
  const tag = pendingDelete.value
  pendingDelete.value = ''
  if (!tag) return
  await deleteTag(tag)
}

/* ---------------------------------------------------------------------------
   样式
   --------------------------------------------------------------------------- */
const GHOST_CLASS =
  'rounded-none border border-transparent px-2 py-1 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]'

const SMALL_BUTTON =
  'rounded-none border border-black bg-white px-4 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white'

const DANGER_BUTTON =
  'rounded-none border border-[#ff0000] bg-white px-4 py-2 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] text-[#ff0000] transition-colors duration-150 ease-out hover:bg-[#ff0000] hover:text-white'
</script>

<template>
  <AdminDataState v-if="!dataOk" />

  <!-- 数据未就绪时不渲染内容：加载中显示空列表、出错显示空列表，都会让人以为数据没了 -->
  <div v-else class="py-12 md:py-16">
    <!-- ============ 页头 ============ -->
    <div class="flex flex-wrap items-end justify-between gap-6 border-b border-black pb-6">
      <div>
        <p class="swiss-meta mb-4 text-black/60">02 — Tags</p>
        <h1 class="font-sans text-2xl font-bold uppercase tracking-tight md:text-3xl">标签管理</h1>
        <p class="swiss-meta mt-3 text-black/50">共 {{ allTags.length }} 个标签</p>
      </div>
    </div>

    <p class="mt-8 max-w-[68ch] font-sans text-sm leading-relaxed text-black/60">
      标签是挂在作品上的自由字符串，用于描述玩法 / 风格 / 平台等特征，与「IP 系列」并列而非替代。
      重命名会同步改掉所有引用它的作品；删除只摘掉标签本身，
      <span class="font-bold text-black">不会删除任何作品</span>。
    </p>

    <!-- ============ 数据现状 ============ -->
    <div class="mt-8 border border-[#cccccc] border-l-4 border-l-black px-6 py-5">
      <p class="swiss-meta text-black/60">数据现状</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        标签没有独立存储 —— 它只是各条作品上的字符串数组。因此数据源里既有的标签
        <span class="font-bold text-black">没有创建时间可言</span>，「创建时间」列只记录本次会话中
        由后台首次引入的标签，其余显示「—」。独立的 tags / game_tags 表要到 Phase 14
        接入远程库时才会建立，本阶段不为了填满一列而伪造日期。
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
            {{ lastOutcome.label }} —— 影响了 {{ lastOutcome.changed }} 条作品
          </p>
          <p class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
            {{ STORAGE_NOTICE[lastOutcome.storage] }}
          </p>
        </div>
        <button type="button" :class="GHOST_CLASS" @click="dismissOutcome">知道了</button>
      </div>
    </div>

    <!-- ============ 删除确认（页内） ============ -->
    <div
      v-if="pendingDelete"
      class="mt-8 border border-[#ff0000] px-6 py-5"
      role="alert"
      aria-live="assertive"
    >
      <p class="swiss-meta font-bold text-[#ff0000]">确认删除标签「{{ pendingDelete }}」？</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        该标签当前被 {{ pendingDeleteUsage }} 款作品使用，删除后会从这些作品上一并摘掉。
        作品本身不会被删除，但 <span class="font-bold text-black">这个操作影响多条记录</span>。
      </p>
      <div class="mt-5 flex flex-wrap gap-3">
        <button type="button" :class="DANGER_BUTTON" @click="confirmDelete">确认删除</button>
        <button type="button" :class="SMALL_BUTTON" @click="pendingDelete = ''">取消</button>
      </div>
    </div>

    <!-- ============ 搜索 ============ -->
    <section class="mt-8 border border-black">
      <div class="p-6 md:p-8">
        <label class="swiss-meta mb-3 block text-black/60" for="tag-search">关键词搜索</label>
        <div class="flex flex-wrap items-stretch gap-3">
          <input
            id="tag-search"
            type="search"
            autocomplete="off"
            placeholder="输入标签名…"
            v-model="searchText"
            class="min-w-[240px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none"
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
    </section>

    <!-- ============ 列表 ============ -->
    <p class="swiss-meta mb-4 mt-12 text-black/60">
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
            <!-- 名称（含行内重命名） -->
            <td class="border-r border-[#cccccc] px-4 py-4 align-middle">
              <template v-if="editingTag === tag.name">
                <div class="flex flex-wrap items-center gap-3">
                  <input
                    v-model="renameDraft"
                    type="text"
                    autocomplete="off"
                    :maxlength="TAG_LIMITS.maxLength"
                    class="min-w-[180px] rounded-none border border-black bg-white px-3 py-2 font-sans text-sm focus:border-[#ff0000] focus:outline-none"
                    @keyup.enter="submitRename"
                  />
                  <button type="button" :class="SMALL_BUTTON" @click="submitRename">保存</button>
                  <button type="button" :class="GHOST_CLASS" @click="cancelRename">取消</button>
                </div>
                <p v-if="renameNotice" class="mt-2 font-sans text-xs text-[#ff0000]" role="alert">
                  {{ renameNotice }}
                </p>
                <p v-else-if="renamePreview && renamePreview !== tag.name" class="mt-2 font-sans text-xs text-black/50">
                  将重命名为「{{ renamePreview }}」，并同步更新所有使用它的作品
                </p>
              </template>

              <span v-else class="font-sans text-sm font-bold">{{ tag.name }}</span>
            </td>

            <!-- 使用数量 -->
            <td class="border-r border-[#cccccc] px-4 py-4 text-right align-middle">
              <span class="font-sans text-xs tabular-nums">{{ tag.usage }} 款</span>
            </td>

            <!-- 创建时间 -->
            <td class="border-r border-[#cccccc] px-4 py-4 text-right align-middle">
              <span class="font-sans text-xs tabular-nums text-black/70">
                {{ formatTimestamp(tag.createdAt) }}
              </span>
            </td>

            <!-- 操作 -->
            <td class="px-4 py-4 align-middle">
              <div class="flex flex-col items-start gap-2">
                <button
                  type="button"
                  class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:text-[#ff0000]"
                  @click="startRename(tag.name)"
                >
                  重命名
                </button>
                <button
                  type="button"
                  class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-[#ff0000] transition-colors duration-150 ease-out hover:text-black"
                  @click="startDelete(tag.name)"
                >
                  删除
                </button>
              </div>
            </td>
          </tr>

          <!-- 空状态 -->
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
  </div>
</template>
