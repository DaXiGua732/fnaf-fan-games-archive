<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, onBeforeRouteLeave, useRouter } from 'vue-router'
import AdminDataState from '../../components/admin/AdminDataState.vue'
import AdminDownloadEditor from '../../components/admin/AdminDownloadEditor.vue'
import AdminEditorSection from '../../components/admin/AdminEditorSection.vue'
import AdminFeatureSettings from '../../components/admin/AdminFeatureSettings.vue'
import AdminField from '../../components/admin/AdminField.vue'
import AdminGalleryEditor from '../../components/admin/AdminGalleryEditor.vue'
import AdminImageSlot from '../../components/admin/AdminImageSlot.vue'
import AdminPublishOverview from '../../components/admin/AdminPublishOverview.vue'
import AdminPublishSettings from '../../components/admin/AdminPublishSettings.vue'
import AdminTagEditor from '../../components/admin/AdminTagEditor.vue'
import {
  draftToPatch,
  emptyErrors,
  provideAdminGameDraft,
} from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { PREVIEW_PATH, publishPreview } from '../../composables/useGamePreview'
import { blankGame, slugify } from '../../utils/gameFactory'
import { DRAFT_TEXT_FIELDS, STORAGE_NOTICE, type AdminGame, type DraftErrors } from '../../types/admin'
import type { StorageKind } from '../../types/admin'

/**
 * AdminGameEditor —— 游戏编辑页
 *
 * 阶段进度：Phase 4 建立版式骨架 → **Phase 5 接入「基本信息」七个字段 + 草稿态 + 保存草稿**。
 *   标签 → Phase 6 · 图片 → Phase 7 · 下载资源 → Phase 8 · 发布设置与推荐排序 → Phase 9
 *
 * 【数据流】读取走 useAdminGames（模块级单例）；编辑走 useAdminGameDraft（每次会话一个实例）；
 * 写回只经过 useAdminGames.saveGame()。本页不做任何 .filter() / .sort()，也不 import db.json。
 *
 * 【为什么在 setup 里同步 loadFrom，而不是 onMounted】
 *   SSR 首帧必须就渲染出正确的输入值。放到 onMounted 会让服务端渲染出空表单、
 *   客户端再填上，造成 hydration 不一致，也让 SSR 冒烟断言不到任何字段值。
 */
const props = defineProps<{ id?: string }>()

const router = useRouter()
const { getGameById, saveGame, deleteGame, availableAuthors, dataOk } = useAdminGames()

// 用 provide 版本：标签录入等子组件要拿到**同一个**草稿实例
const {
  draft,
  errors,
  isValid,
  canSave,
  publishIssues,
  isDirty,
  changedFields,
  touched,
  loadFrom,
  resetToBaseline,
  markSaved,
} = provideAdminGameDraft()

/** 新增模式：路由 /admin/games/new 不传 id */
const isNew = computed(() => !props.id)

/**
 * 图片在数据仓里的归属目录名。
 *
 * 草稿本身没有 id 字段（id 不属于可编辑内容），所以已有作品取**路由参数**；
 * 新作品还没 id，用标题的 slug 顶上（图片本来就跟着标题走）；
 * 两者都没有就落到 unassigned —— 宁可目录难看，
 * 也不要把图片传到一个将来找不到的地方。
 */
const imageOwnerId = computed(() => props.id || slugify(draft.title) || 'unassigned')
/** 编辑模式下的目标条目；id 不存在时为 undefined */
const game = computed(() => (props.id ? getGameById(props.id) : undefined))
const notFound = computed(() => !isNew.value && game.value === undefined)

const subheading = computed(() => {
  if (isNew.value) return '新作品 · id 将在首次保存时生成'
  if (!game.value) return ''
  return `${game.value.id} · ${game.value.title}`
})

/* ---------------------------------------------------------------------------
   校验错误的展示时机
   进入页面就飘一片红字是很糟的体验，所以只有「改动过」或「提交过一次」之后才开始显示。
   （空错误对象与文本字段清单都从深模块 / 类型层取，不在这里重写一遍）
   --------------------------------------------------------------------------- */
/**
 * 校验错误的展示时机。
 *
 * 两条规则叠加，兼顾「不要一进页面就飘一片红字」和「改错了要立刻知道」：
 *   1. 字段一旦被改动过 → 立刻显示它的错误（改到一半就能看到提示）
 *   2. 点击过保存 → 全部字段都显示错误
 *
 * 标签没有校验错误（约束由 useAdminGameDraft 的 readTags 收口），所以这里只处理文本字段。
 */
const shownErrors = computed<DraftErrors>(() => {
  if (touched.value) return errors.value
  const changed = new Set<string>(changedFields.value)
  const result = emptyErrors()
  for (const field of DRAFT_TEXT_FIELDS) {
    if (changed.has(field)) result[field] = errors.value[field]
  }
  return result
})

/* ---------------------------------------------------------------------------
   保存状态
   --------------------------------------------------------------------------- */
interface SaveBanner {
  mode: 'created' | 'updated'
  id: string
  /** 这次保存实际落在了哪里 —— 提示条据此说准确的话 */
  storage: StorageKind
}

const saving = ref(false)
const savedOutcome = ref<SaveBanner | null>(null)
const saveError = ref('')

/* ---------------------------------------------------------------------------
   加载 / 重载
   --------------------------------------------------------------------------- */
loadFrom(game.value)

/**
 * 新增与编辑两个路由**共用同一个组件**，props.id 变化不会重跑 setup，
 * 所以必须显式重载草稿；否则新建成功跳到编辑路由后会继续显示旧草稿。
 *
 * ⚠️ 这里**不要**清空 savedOutcome：新建成功后紧接着就会 replace 到编辑路由，
 *    清掉的话用户根本看不到保存结果提示条。
 */
watch(
  () => props.id,
  () => {
    loadFrom(game.value)
  },
)

/* ---------------------------------------------------------------------------
   离开页面拦截
   --------------------------------------------------------------------------- */
/**
 * 用**页内确认条**而不是 `window.confirm`。
 *
 * 原因：内嵌 webview / 跨域 iframe 里原生弹窗可能被静默拦截，
 * 用户只会看到「点了没反应」，且无法区分「被拦了」和「没点到」——
 * 这与 README §9.6 记录的剪贴板事故是同一类问题。
 * 通用原则：任何用户触发的操作，失败或需要确认时都必须有**可见**的交互，不能依赖原生弹窗。
 */
let allowLeave = false
const pendingLeavePath = ref('')

onBeforeRouteLeave((to) => {
  if (!isDirty.value || allowLeave) return true
  pendingLeavePath.value = to.fullPath
  return false
})

async function confirmLeave(): Promise<void> {
  const path = pendingLeavePath.value
  pendingLeavePath.value = ''
  if (!path) return
  allowLeave = true
  await router.push(path)
  allowLeave = false
}

function cancelLeave(): void {
  pendingLeavePath.value = ''
}

/* ---------------------------------------------------------------------------
   永久删除
   ---------------------------------------------------------------------------
   不可逆动作，所以要求**手工输入作品 id** 才能执行 —— 「点两次按钮」挡不住手滑，
   输入一串自己刚看到的标识才会让人真的意识到删的是哪一条。
   确认区是页内展开的，不用 window.confirm（可能被静默拦截，见 README §9.6）。
   --------------------------------------------------------------------------- */
const confirmingDelete = ref(false)
const deleteConfirmText = ref('')
const deleting = ref(false)
const deleteError = ref('')

const canConfirmDelete = computed(
  () => Boolean(props.id) && deleteConfirmText.value.trim() === props.id,
)

function openDelete(): void {
  confirmingDelete.value = true
  deleteConfirmText.value = ''
  deleteError.value = ''
}

function cancelDelete(): void {
  confirmingDelete.value = false
  deleteConfirmText.value = ''
  deleteError.value = ''
}

async function confirmDelete(): Promise<void> {
  if (!props.id || !canConfirmDelete.value || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteGame(props.id)
    // 条目已经不存在了，离开拦截不再有意义
    allowLeave = true
    await router.replace({ name: 'admin-games' })
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : '删除失败'
  } finally {
    deleting.value = false
  }
}

/* ---------------------------------------------------------------------------
   保存 / 发布
   --------------------------------------------------------------------------- */
/** 实际落库的动作。onSave 与 onPublish 都走这里，区别只在「保存前有没有把状态改成已上线」 */
async function persist(): Promise<void> {
  saving.value = true
  try {
    // 转换与校验都在 useAdminGameDraft 内，各只有一处职责
    const outcome = await saveGame({ id: props.id, patch: draftToPatch(draft) })
    markSaved()
    savedOutcome.value = { mode: outcome.mode, id: outcome.game.id, storage: outcome.storage }

    // 新建成功后切到编辑路由：否则停留在 /new 上再点一次保存会又建一条
    if (outcome.mode === 'created') {
      await router.replace({ name: 'admin-game-edit', params: { id: outcome.game.id } })
    }
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    saving.value = false
  }
}

/** 保存：按表单当前内容落库（状态就是表单里选的那个） */
async function onSave(): Promise<void> {
  touched.value = true
  savedOutcome.value = null
  saveError.value = ''
  if (!canSave.value) return
  await persist()
}

/** 发布：把状态切到「已上线」再保存 —— 等价于「选已上线 + 保存」的快捷方式 */
async function onPublish(): Promise<void> {
  draft.status = 'published'
  await onSave()
}

/**
 * 预览：把当前草稿交给**真实的前台详情页**渲染。
 *
 * 【为什么开新标签页】导航去预览页会卸载本页 —— 而草稿是每个编辑会话一份的，
 * 卸载即丢弃，未保存的改动就没了（离开拦截也是为这件事存在的）。
 * 新标签页毫发无损：本页不动，草稿原样留在原地。
 *
 * 【预览数据怎么来】以已保存的那条为底（保住 metrics 这类不可编辑字段），
 * 再把草稿盖上去 —— 于是「能编辑的字段是新的，不能编辑的字段还在」。
 * 传给预览页的方式是 sessionStorage：跨标签页只能靠 storage。
 */
function onPreview(): void {
  const source = props.id ? getGameById(props.id) : undefined
  const preview: AdminGame = {
    ...(source ?? blankGame()),
    ...draftToPatch(draft),
    id: props.id || 'preview',
  }
  publishPreview(preview)
  window.open(`${import.meta.env.BASE_URL}#${PREVIEW_PATH}`, '_blank', 'noopener')
}

/* ---------------------------------------------------------------------------
   各区块的「已修改」标记
   changedFields 是全局的字段级列表，区块想知道「我这里面有没有改动的」
   就必须显式声明自己包含哪些字段 —— 否则「改了封面」会点亮「基本信息」。
   --------------------------------------------------------------------------- */
const BASIC_FIELDS: string[] = [
  'title',
  'author',
  'releaseYear',
  'ipSeries',
  'engine',
  'videoUrl',
  'description',
]
const basicChanged = computed(() => changedFields.value.some((field) => BASIC_FIELDS.includes(field)))

const MEDIA_FIELDS: string[] = ['coverImage', 'bannerImage']
const mediaChanged = computed(() => changedFields.value.some((field) => MEDIA_FIELDS.includes(field)))

const PUBLISH_FIELDS: string[] = ['status', 'archived']
const publishChanged = computed(() =>
  changedFields.value.some((field) => PUBLISH_FIELDS.includes(field)),
)

const FEATURE_FIELDS: string[] = ['featured', 'sortOrder']
const featureChanged = computed(() =>
  changedFields.value.some((field) => FEATURE_FIELDS.includes(field)),
)

/* ---------------------------------------------------------------------------
   分区导航（参考创作中心的左侧/顶部章节导航）
   ---------------------------------------------------------------------------
   长表单最烦的是「改完封面想回去改标题」要滚很久。这里把区块收成一条
   吸顶的索引，点一下直接跳过去，并在有未保存改动的区块上点一个红点。
   --------------------------------------------------------------------------- */
const SECTIONS = computed(() => [
  { id: 'section-basic', label: '基本信息', changed: basicChanged.value },
  { id: 'section-media', label: '封面与宣传图', changed: mediaChanged.value },
  { id: 'section-gallery', label: '图库', changed: changedFields.value.includes('gallery') },
  { id: 'section-downloads', label: '下载资源', changed: changedFields.value.includes('downloads') },
  { id: 'section-tags', label: '标签', changed: changedFields.value.includes('tags') },
  { id: 'section-publish', label: '发布设置', changed: publishChanged.value },
  { id: 'section-feature', label: '推荐与排序', changed: featureChanged.value },
])

/** 页内跳转：不用 `href="#id"` —— Hash 路由下那会被当成路由跳转 */
function jumpTo(id: string): void {
  if (typeof document === 'undefined') return
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
}

/**
 * Ctrl / Cmd + S 保存。
 * 只在「有改动且可保存」时生效 —— 否则每按一次就产生一个空提交。
 * 输入框里也照常生效：这正是快捷键的意义（不用先点空白处再按）。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  if (saving.value || !isDirty.value || !canSave.value) return
  void onSave()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/* ---------------------------------------------------------------------------
   样式
   --------------------------------------------------------------------------- */
const INPUT_CLASS =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'

const ACTION_BASE =
  'inline-flex items-center gap-3 border px-6 py-3 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.16em] transition-colors duration-150 ease-out'

const ACTION_SECONDARY = `${ACTION_BASE} border-black bg-white hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30`

const ACTION_PRIMARY = `${ACTION_BASE} border-black bg-black text-white hover:border-[#ff0000] hover:bg-[#ff0000] disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:bg-white disabled:text-black/30 disabled:hover:border-[#cccccc] disabled:hover:bg-white disabled:hover:text-black/30`

const ACTION_DANGER = `${ACTION_BASE} border-[#ff0000] bg-white text-[#ff0000] hover:bg-[#ff0000] hover:text-white`
</script>

<template>
  <!-- ==================== 找不到该作品 ==================== -->
  <AdminDataState v-if="!dataOk" />

  <!-- ==================== 找不到该作品 ==================== -->
  <div v-else-if="notFound" class="py-12 md:py-16">
    <p class="swiss-meta mb-6 text-black/60">Error 404 — Game Not Found</p>

    <h1 class="font-sans text-2xl font-bold uppercase leading-[0.95] tracking-tight md:text-4xl">
      找不到这个作品
    </h1>

    <p class="mt-8 max-w-[62ch] font-sans text-sm leading-relaxed text-black/60">
      资源库中没有 id 为 <span class="font-bold tracking-[0.2em]">{{ props.id }}</span> 的条目。
      可能链接已失效，或该作品尚未被收录。
    </p>

    <RouterLink
      :to="{ name: 'admin-games' }"
      class="group mt-10 inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-[#ff0000] hover:bg-[#ff0000]"
    >
      <span>返回游戏管理</span>
      <span class="u-arrow" aria-hidden="true">&#8594;</span>
    </RouterLink>
  </div>

  <!-- ==================== 编辑器 ==================== -->
  <div v-else class="py-12 md:py-16">
    <!-- ============ 页头 ============ -->
    <div class="flex flex-wrap items-end justify-between gap-6 border-b border-black pb-6">
      <div>
        <p class="swiss-meta mb-4 text-black/60">01 — Games / {{ isNew ? 'New' : 'Edit' }}</p>
        <h1 class="font-sans text-2xl font-bold uppercase tracking-tight md:text-3xl">
          {{ isNew ? '新增游戏' : '编辑游戏' }}
        </h1>
        <p class="swiss-meta mt-3 text-black/50">{{ subheading }}</p>
      </div>

      <RouterLink :to="{ name: 'admin-games' }" :class="ACTION_SECONDARY">返回列表</RouterLink>
    </div>

    <!-- ============ 吸顶操作条 + 分区导航 ============ -->
    <div class="sticky top-14 z-40 -mt-px border-b border-black bg-white py-3">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <p
          class="swiss-meta"
          :class="isDirty ? 'font-bold text-[#ff0000]' : 'text-black/45'"
          aria-live="polite"
        >
          <template v-if="saving">正在保存……</template>
          <template v-else-if="isDirty">未保存的修改 · {{ changedFields.length }} 个字段</template>
          <template v-else>没有未保存的修改</template>
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            :class="ACTION_SECONDARY"
            :disabled="!isDirty || saving"
            @click="resetToBaseline"
          >
            撤销修改
          </button>

          <button type="button" :class="ACTION_SECONDARY" :disabled="saving" @click="onPreview">
            预览
          </button>

          <button
            type="button"
            :class="ACTION_PRIMARY"
            :disabled="!isDirty || saving"
            title="Ctrl / Cmd + S"
            @click="onSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>

          <!-- 「发布」= 把状态切到已上线再保存，等价于「选已上线 + 保存」的快捷方式 -->
          <button
            type="button"
            :class="ACTION_SECONDARY"
            :disabled="saving || (draft.status === 'published' && !isDirty)"
            @click="onPublish"
          >
            发布
          </button>
        </div>
      </div>

      <nav class="mt-3 flex items-center gap-1 overflow-x-auto" aria-label="编辑分区">
        <button
          v-for="section in SECTIONS"
          :key="section.id"
          type="button"
          class="shrink-0 border border-transparent px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]"
          @click="jumpTo(section.id)"
        >
          {{ section.label }}
          <span v-if="section.changed" class="ml-1 text-[#ff0000]" aria-label="有未保存修改">·</span>
        </button>

        <span class="ml-auto hidden shrink-0 pl-4 swiss-meta text-black/30 md:block">
          Ctrl / &#8984; + S 保存
        </span>
      </nav>
    </div>

    <!-- ============ 离开确认（页内，不用原生弹窗） ============ -->
    <div
      v-if="pendingLeavePath"
      class="mt-8 border border-[#ff0000] px-6 py-5"
      role="alert"
      aria-live="assertive"
    >
      <p class="swiss-meta font-bold text-[#ff0000]">这个作品有未保存的修改</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        离开后这些修改会丢失，且无法恢复 —— 它们还没有保存到数据仓。
      </p>
      <div class="mt-5 flex flex-wrap gap-3">
        <button type="button" :class="ACTION_DANGER" @click="confirmLeave">
          放弃修改并离开
        </button>
        <button type="button" :class="ACTION_SECONDARY" @click="cancelLeave">留在本页</button>
      </div>
    </div>

    <!-- ============ 阶段说明 ============ -->
    <p class="mt-8 max-w-[78ch] font-sans text-xs leading-relaxed text-black/60">
      保存会通过 GitHub API 提交到数据仓，前台要等下一次构建（自动每小时一次，可手动触发）。
      <span class="font-bold text-black">「已上线」要求封面、Banner 与至少一个下载渠道</span>
      —— 内容没凑齐时先留在草稿。
    </p>

    <!-- ============ 保存结果 ============ -->
    <div
      v-if="savedOutcome"
      class="mt-8 border border-[#cccccc] border-l-4 border-l-[#ff0000] px-6 py-5"
      role="status"
      aria-live="polite"
    >
      <p class="swiss-meta text-black/60">保存结果</p>
      <p class="mt-2 font-sans text-sm font-bold">
        {{ savedOutcome.mode === 'created' ? '已新建' : '已更新' }}
        <span class="tracking-[0.1em]">{{ savedOutcome.id }}</span>
      </p>
      <p class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        {{ STORAGE_NOTICE[savedOutcome.storage] }}
      </p>
    </div>

    <!-- ============ 保存失败 ============ -->
    <div v-if="saveError" class="mt-8 border border-[#ff0000] px-6 py-5" role="alert">
      <p class="swiss-meta font-bold text-[#ff0000]">保存失败</p>
      <p class="mt-2 font-sans text-xs text-black/70">{{ saveError }}</p>
    </div>

    <!-- ============ 校验未通过 ============ -->
    <div
      v-if="touched && !isValid"
      class="mt-8 border border-[#cccccc] border-l-4 border-l-[#ff0000] px-6 py-5"
      role="alert"
    >
      <p class="swiss-meta font-bold text-[#ff0000]">还有字段未通过校验</p>
      <p class="mt-2 font-sans text-xs leading-relaxed text-black/70">
        请修正下方标红的字段后再保存。错误会随输入实时更新。
      </p>
    </div>

    <!-- ============ 发布缺口拦下了保存 ============ -->
    <div
      v-if="touched && isValid && !canSave"
      class="mt-8 border border-[#cccccc] border-l-4 border-l-[#ff0000] px-6 py-5"
      role="alert"
    >
      <p class="swiss-meta font-bold text-[#ff0000]">
        保存被拦下了 —— 「已上线」状态还差 {{ publishIssues.length }} 项
      </p>
      <p class="mt-2 font-sans text-xs leading-relaxed text-black/70">
        缺口清单在右栏「发布设置」区块里。内容没凑齐之前，可以先切回「草稿」保存。
      </p>
    </div>

    <!-- ============ 两栏主体 ============ -->
    <div class="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-16">
      <!-- ---------- 左栏 ---------- -->
      <div class="flex flex-col gap-12">
        <!-- 基本信息（Phase 5 已接入） -->
        <AdminEditorSection title="基本信息" anchor="section-basic" :changed="basicChanged">
          <div class="grid gap-6 md:grid-cols-2">
            <AdminField label="游戏名称" control-id="f-title" required :error="shownErrors.title">
              <input
                id="f-title"
                v-model="draft.title"
                type="text"
                autocomplete="off"
                placeholder="英文原名，如 The Joy of Creation: Reborn"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.title)"
              />
            </AdminField>

            <AdminField
              label="作者"
              control-id="f-author"
              required
              :error="shownErrors.author"
              hint="可从已有作者中选择，或输入新作者"
            >
              <input
                id="f-author"
                v-model="draft.author"
                type="text"
                autocomplete="off"
                list="admin-author-options"
                placeholder="作者 / 团队名"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.author)"
              />
              <datalist id="admin-author-options">
                <option v-for="author in availableAuthors" :key="author" :value="author" />
              </datalist>
            </AdminField>

            <AdminField
              label="发行年份"
              control-id="f-year"
              required
              :error="shownErrors.releaseYear"
              hint="4 位年份，如 2019"
            >
              <!--
                ⚠️ 刻意用 type="text" + inputmode="numeric"，不用 type="number"：
                Vue 的 v-model 会把 number 输入框的值**自动转成 Number**，
                绕过 TS 的类型约束，让「string 字段」在运行时变成数字。
                年份只需要 4 位数字，不需要步进器；格式交给 validateDraft 管。
              -->
              <input
                id="f-year"
                v-model="draft.releaseYear"
                type="text"
                inputmode="numeric"
                maxlength="4"
                autocomplete="off"
                placeholder="2019"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.releaseYear)"
              />
            </AdminField>

            <AdminField label="IP 系列" control-id="f-series" required :error="shownErrors.ipSeries">
              <input
                id="f-series"
                v-model="draft.ipSeries"
                type="text"
                autocomplete="off"
                placeholder="如 FNAF 主线同人"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.ipSeries)"
              />
            </AdminField>

            <AdminField label="开发引擎" control-id="f-engine" required :error="shownErrors.engine">
              <input
                id="f-engine"
                v-model="draft.engine"
                type="text"
                autocomplete="off"
                placeholder="如 Unreal Engine 4"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.engine)"
              />
            </AdminField>

            <AdminField
              label="视频 URL"
              control-id="f-video"
              :error="shownErrors.videoUrl"
              hint="可留空。填了必须是完整链接"
            >
              <input
                id="f-video"
                v-model="draft.videoUrl"
                type="url"
                autocomplete="off"
                placeholder="https://…"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.videoUrl)"
              />
            </AdminField>

            <AdminField
              label="简介"
              control-id="f-desc"
              required
              class="md:col-span-2"
              :error="shownErrors.description"
            >
              <textarea
                id="f-desc"
                v-model="draft.description"
                rows="8"
                placeholder="中文简介，说明作品的核心玩法与特点"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.description)"
              />
            </AdminField>
          </div>
        </AdminEditorSection>

        <!-- 封面与宣传图（Phase 7 已接入） -->
        <AdminEditorSection
          title="封面与宣传图"
          anchor="section-media"
          :changed="mediaChanged"
        >
          <div class="flex flex-col gap-10">
            <AdminImageSlot
              field="coverImage"
              :game-id="imageOwnerId"
              control-id="f-cover"
              label="封面图"
              ratio="aspect-video"
              :error="shownErrors.coverImage"
              hint="列表卡片与搜索结果使用，建议 16:9 或更方"
            />
            <AdminImageSlot
              field="bannerImage"
              :game-id="imageOwnerId"
              control-id="f-banner"
              label="Banner 宣传图"
              ratio="aspect-[21/9]"
              :error="shownErrors.bannerImage"
              hint="详情页顶部大图，建议 21:9 横幅"
            />
          </div>
        </AdminEditorSection>

        <!-- 图库（Phase 7 已接入） -->
        <AdminEditorSection
          title="图库"
          anchor="section-gallery"
          :changed="changedFields.includes('gallery')"
        >
          <AdminGalleryEditor :game-id="imageOwnerId" />
        </AdminEditorSection>

        <!-- 下载资源（Phase 8 已接入） -->
        <AdminEditorSection
          title="下载资源"
          anchor="section-downloads"
          :changed="changedFields.includes('downloads')"
        >
          <AdminDownloadEditor />
        </AdminEditorSection>

        <!-- 标签（Phase 6 已接入）—— 贴近内容区，符合「先写内容、再设发布」的顺序 -->
        <AdminEditorSection
          title="标签"
          anchor="section-tags"
          :changed="changedFields.includes('tags')"
        >
          <AdminTagEditor />
        </AdminEditorSection>
      </div>

      <!-- ---------- 右栏 ---------- -->
      <aside class="flex flex-col gap-8">
        <!-- 发布概览：封面 / 状态 / 上线清单 / 上次保存（参考创作中心的发布面板） -->
        <AdminPublishOverview :game="game" :is-new="isNew" @preview="onPreview" />

        <AdminEditorSection
          title="发布设置"
          anchor="section-publish"
          :changed="publishChanged"
        >
          <AdminPublishSettings />
        </AdminEditorSection>

        <AdminEditorSection
          title="推荐与排序"
          anchor="section-feature"
          :changed="featureChanged"
        >
          <AdminFeatureSettings />
        </AdminEditorSection>
      </aside>
    </div>

    <!-- ============ 危险操作：永久删除 ============ -->
    <section
      v-if="!isNew && game"
      class="mt-16 border border-[#ff0000] px-6 py-6"
      aria-labelledby="danger-zone-title"
    >
      <p class="swiss-meta text-[#ff0000]">危险操作</p>
      <h2 id="danger-zone-title" class="mt-2 font-sans text-lg font-bold">永久删除这条作品</h2>

      <p class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        删除会从数据仓移除 <span class="font-bold text-black">{{ game.id }}</span>，
        并清理只被它引用的上传图片。这一步在后台无法撤销 —— 真要找回，
        只能去数据仓的 git 历史里 revert。
      </p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        如果只是不想让它在线上出现，用右栏「发布设置 → 下线」即可；下线不删数据，随时能恢复。
      </p>

      <div v-if="!confirmingDelete" class="mt-5">
        <button type="button" :class="ACTION_DANGER" @click="openDelete">删除这条作品</button>
      </div>

      <div v-else class="mt-5 border-t border-[#ff0000] pt-5" role="alert" aria-live="assertive">
        <p class="max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
          请输入作品 id <span class="font-bold text-black">{{ game.id }}</span> 以确认：
        </p>
        <div class="mt-3 flex flex-wrap items-stretch gap-3">
          <input
            v-model="deleteConfirmText"
            type="text"
            autocomplete="off"
            :placeholder="game.id"
            :class="[INPUT_CLASS, 'max-w-sm']"
            :aria-label="`输入 ${game.id} 以确认删除`"
          />
          <button
            type="button"
            :class="ACTION_DANGER"
            :disabled="!canConfirmDelete || deleting"
            @click="confirmDelete"
          >
            {{ deleting ? '正在删除……' : '确认永久删除' }}
          </button>
          <button type="button" :class="ACTION_SECONDARY" :disabled="deleting" @click="cancelDelete">
            取消
          </button>
        </div>

        <p v-if="deleteError" class="mt-3 max-w-[78ch] font-sans text-xs text-[#ff0000]" role="alert">
          {{ deleteError }}
        </p>
      </div>
    </section>
  </div>
</template>
