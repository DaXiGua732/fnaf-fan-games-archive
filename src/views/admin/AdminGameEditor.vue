<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, onBeforeRouteLeave, useRouter } from 'vue-router'
import AdminConfirmDialog from '../../components/admin/AdminConfirmDialog.vue'
import AdminDataState from '../../components/admin/AdminDataState.vue'
import AdminDownloadEditor from '../../components/admin/AdminDownloadEditor.vue'
import AdminEditorSection from '../../components/admin/AdminEditorSection.vue'
import AdminFeatureSettings from '../../components/admin/AdminFeatureSettings.vue'
import AdminField from '../../components/admin/AdminField.vue'
import AdminGalleryEditor from '../../components/admin/AdminGalleryEditor.vue'
import AdminGameJoltImport from '../../components/admin/AdminGameJoltImport.vue'
import AdminImageSlot from '../../components/admin/AdminImageSlot.vue'
import AdminPublishOverview from '../../components/admin/AdminPublishOverview.vue'
import AdminPublishSettings from '../../components/admin/AdminPublishSettings.vue'
import AdminTagEditor from '../../components/admin/AdminTagEditor.vue'
import AdminRelationEditor from '../../components/admin/AdminRelationEditor.vue'
import AdminAltTitleEditor from '../../components/admin/AdminAltTitleEditor.vue'
import AdminVocabularyPicker from '../../components/admin/AdminVocabularyPicker.vue'
import {
  draftToPatch,
  emptyErrors,
  provideAdminGameDraft,
} from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { PREVIEW_PATH, publishPreview } from '../../composables/useGamePreview'
import { slugify } from '../../utils/gameFactory'
import { scrollToId } from '../../utils/scroll'
import {
  DRAFT_GROUP_FIELDS,
  DRAFT_TEXT_FIELDS,
  STORAGE_NOTICE,
  type DraftErrors,
  type StorageKind,
} from '../../types/admin'
import { DEVELOPMENT_STATUSES, DEVELOPMENT_STATUS_LABELS } from '../../types/game'

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
  previewGame,
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
  if (isNew.value) return '新作品 · 第一次保存后会自动生成 id'
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
  for (const field of [...DRAFT_TEXT_FIELDS, ...DRAFT_GROUP_FIELDS]) {
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
   ---------------------------------------------------------------------------
   本地仓储是同步就绪的，`game` 在 setup 里就能读到；但登录后换成远程仓储时，
   `db.json` 要经过一次网络请求才到 —— 这时 setup 里的 `game` 是 undefined。
   旧实现直接在 setup 调用 `loadFrom(game.value)`，于是**刷新 / 书签 / 登录跳转**
   进入编辑页会得到一个空表单，用户一保存就把整条作品覆盖成空白。

   所以加载必须等数据就绪，并且以「id 变化」为触发条件（而不是 game 对象的每次变化，
   否则保存后仓储回写会让草稿重新加载，覆盖刚输入的内容）。
   --------------------------------------------------------------------------- */
const loadedDraftId = ref('')
const NEW_DRAFT_ID = '__new__'

function syncDraftFromCatalog(): void {
  if (!dataOk.value) return

  if (isNew.value) {
    if (loadedDraftId.value !== NEW_DRAFT_ID) {
      loadFrom(undefined)
      loadedDraftId.value = NEW_DRAFT_ID
    }
    return
  }

  const current = game.value
  if (!current || loadedDraftId.value === current.id) return
  loadFrom(current)
  loadedDraftId.value = current.id
}

syncDraftFromCatalog()

/**
 * 新增与编辑两个路由**共用同一个组件**，props.id 变化不会重跑 setup，
 * 所以必须显式重载草稿；否则新建成功跳到编辑路由后会继续显示旧草稿。
 * 同时监听 `dataOk` 与 `game.id`：远程数据晚到时，等它到了再填表单。
 *
 * ⚠️ 这里**不要**清空 savedOutcome：新建成功后紧接着就会 replace 到编辑路由，
 *    清掉的话用户根本看不到保存结果提示条。
 */
watch([() => props.id, dataOk, () => game.value?.id], syncDraftFromCatalog)

/* ---------------------------------------------------------------------------
   离开页面拦截
   --------------------------------------------------------------------------- */
/**
 * 用**页内确认条**而不是 `window.confirm`。
 *
 * 原因：内嵌 webview / 跨域 iframe 里原生弹窗可能被静默拦截，
 * 用户只会看到「点了没反应」，且无法区分「被拦了」和「没点到」——
 * 这与 docs/PITFALLS.md 第 12 条记录的剪贴板事故是同一类问题。
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
   不可逆动作，所以走**二次确认弹窗**：点「删除这条作品」→ 弹窗里再点一次确认。
   不用 window.confirm（可能被静默拦截，见 docs/PITFALLS.md 第 12 条）。
   --------------------------------------------------------------------------- */
const confirmingDelete = ref(false)
const deleting = ref(false)
const deleteError = ref('')

function openDelete(): void {
  confirmingDelete.value = true
  deleteError.value = ''
}

function cancelDelete(): void {
  if (deleting.value) return
  confirmingDelete.value = false
  deleteError.value = ''
}

async function confirmDelete(): Promise<void> {
  if (!props.id || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteGame(props.id)
    confirmingDelete.value = false
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
 * 【预览数据怎么来】`previewGame()` 负责「已保存条目 + 草稿覆盖」，
 * 与保存前的关系校验共用同一条组装规则。传给预览页的方式是 localStorage。
 */
function onPreview(): void {
  publishPreview(previewGame())
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
  'shortDescription',
  'description',
  'altTitles',
  'sourceUrl',
  'developmentStatus',
  'platforms',
]
const basicChanged = computed(() => changedFields.value.some((field) => BASIC_FIELDS.includes(field)))

/** 玩法与机制单独一个区块：它们是「怎么玩」，与标准资料字段不是一类 */
const VOCAB_FIELDS: string[] = ['gameplayTypes', 'mechanics']
const vocabChanged = computed(() =>
  changedFields.value.some((field) => VOCAB_FIELDS.includes(field)),
)

/** 关联作品单独一个区块：有向边，不与标签 / 系列混为一谈 */
const relationChanged = computed(() => changedFields.value.includes('relations'))

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
   吸顶的索引，点一下直接跳过去，并在有未保存改动的区块上点一个强调色圆点。
   --------------------------------------------------------------------------- */
const SECTIONS = computed(() => [
  { id: 'section-import', label: 'GameJolt 导入', changed: false },
  { id: 'section-basic', label: '基本信息', changed: basicChanged.value },
  { id: 'section-vocab', label: '玩法与机制', changed: vocabChanged.value },
  { id: 'section-media', label: '封面与宣传图', changed: mediaChanged.value },
  { id: 'section-downloads', label: '下载资源', changed: changedFields.value.includes('downloads') },
  { id: 'section-tags', label: '标签', changed: changedFields.value.includes('tags') },
  { id: 'section-relations', label: '关联作品', changed: relationChanged.value },
  { id: 'section-publish', label: '发布设置', changed: publishChanged.value },
  { id: 'section-feature', label: '推荐与排序', changed: featureChanged.value },
])

/**
 * Ctrl / Cmd + S 保存。
 *
 * 有改动就交给 `onSave()` —— 它会把 `touched` 置为 true，于是校验不通过时
 * 页面会显示具体错误。旧实现在这里先判断 `canSave` 再调用，导致「按了没反应」：
 * 用户不知道是快捷键没生效，还是表单有错。快捷键不能静默失败。
 *
 * 没有改动时不产生空提交；保存中也不重入。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  if (saving.value || !isDirty.value) return
  void onSave()
}

/**
 * 关闭 / 刷新页面时的未保存提醒。
 *
 * 路由离开已有页内确认条；但刷新、关标签页不经过 vue-router，
 * 只能靠 beforeunload。浏览器会显示自己的通用确认文案（无法自定义），
 * 这是唯一能兜住「误按 F5 丢掉草稿」的机制。
 */
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!isDirty.value || allowLeave) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

/* ---------------------------------------------------------------------------
   样式
   --------------------------------------------------------------------------- */
const INPUT_CLASS =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-accent focus:outline-none'

const ACTION_BASE =
  'inline-flex items-center gap-3 border px-6 py-3 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.16em] transition-colors duration-150 ease-out'

const ACTION_SECONDARY = `${ACTION_BASE} border-black bg-white hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30`

const ACTION_PRIMARY = `${ACTION_BASE} border-black bg-black text-white hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-white disabled:text-black/30 disabled:hover:border-line disabled:hover:bg-white disabled:hover:text-black/30`

const ACTION_DANGER = `${ACTION_BASE} border-accent bg-white text-accent hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent`
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
      游戏库里没有 id 为 <span class="font-bold tracking-[0.2em]">{{ props.id }}</span> 的作品。
      可能链接已经失效，或者这款作品还没被收录。
    </p>

    <RouterLink
      :to="{ name: 'admin-games' }"
      class="group mt-10 inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent"
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
          :class="isDirty ? 'font-bold text-accent' : 'text-black/45'"
          aria-live="polite"
        >
          <template v-if="saving">正在保存……</template>
          <template v-else-if="isDirty">未保存的修改 · {{ changedFields.length }} 处</template>
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
          class="shrink-0 border border-transparent px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.12em] text-black/60 transition-colors duration-150 ease-out hover:text-accent"
          @click="scrollToId(section.id)"
        >
          {{ section.label }}
          <span v-if="section.changed" class="ml-1 text-accent" aria-label="有未保存修改">·</span>
        </button>

        <span class="ml-auto hidden shrink-0 pl-4 swiss-meta text-black/30 md:block">
          Ctrl / &#8984; + S 保存
        </span>
      </nav>
    </div>

    <!-- ============ 离开确认（页内，不用原生弹窗） ============ -->
    <div
      v-if="pendingLeavePath"
      class="mt-8 border border-accent px-6 py-5"
      role="alert"
      aria-live="assertive"
    >
      <p class="swiss-meta font-bold text-accent">这个作品有未保存的修改</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        离开后这些修改就没了，也找不回来，因为它们还没保存到数据仓。
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
      点「保存」会把改动提交到数据仓。前台下次打开或切回页面时会自动同步（一般几秒），
      断网时会先用网站上原来的数据。
      <span class="font-bold text-black">想让作品上线，至少要有封面、顶部宣传大图和一条下载渠道</span>；
      这些还没凑齐时，先把状态留在「草稿」。
    </p>

    <!-- ============ 保存结果 ============ -->
    <div
      v-if="savedOutcome"
      class="mt-8 border border-line border-l-4 border-l-accent px-6 py-5"
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
    <div v-if="saveError" class="mt-8 border border-accent px-6 py-5" role="alert">
      <p class="swiss-meta font-bold text-accent">保存失败</p>
      <p class="mt-2 font-sans text-xs text-black/70">{{ saveError }}</p>
    </div>

    <!-- ============ 校验未通过 ============ -->
    <div
      v-if="touched && !isValid"
      class="mt-8 border border-line border-l-4 border-l-accent px-6 py-5"
      role="alert"
    >
      <p class="swiss-meta font-bold text-accent">还有内容没填对</p>
      <p class="mt-2 font-sans text-xs leading-relaxed text-black/70">
        请把下面标红的地方改好再保存。错误提示会随着输入实时更新。
      </p>
    </div>

    <!-- ============ 发布缺口拦下了保存 ============ -->
    <div
      v-if="touched && isValid && !canSave"
      class="mt-8 border border-line border-l-4 border-l-accent px-6 py-5"
      role="alert"
    >
      <p class="swiss-meta font-bold text-accent">
        保存被拦下了 —— 「已上线」状态还差 {{ publishIssues.length }} 项
      </p>
      <p class="mt-2 font-sans text-xs leading-relaxed text-black/70">
        缺什么列在右栏「发布设置」里。内容还没凑齐的话，可以先切回「草稿」保存。
      </p>
    </div>

    <!-- ============ 两栏主体 ============ -->
    <div class="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-16">
      <!-- ---------- 左栏 ---------- -->
      <div class="flex flex-col gap-12">
        <!-- 从 GameJolt 导入：只填草稿 + 传图，不自动保存 -->
        <AdminEditorSection title="从 GameJolt 导入" anchor="section-import" hide-status>
          <AdminGameJoltImport :game-id="imageOwnerId" :is-new="isNew" />
        </AdminEditorSection>

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
              hint="可以从已有作者里选，也可以直接输入新名字"
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
              hint="填 4 位年份，比如 2019"
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
              label="开发状态"
              control-id="f-development"
              hint="作品自身做到哪一步 —— 与网站的「已上线 / 草稿」发布状态无关"
            >
              <select
                id="f-development"
                v-model="draft.developmentStatus"
                :class="INPUT_CLASS"
              >
                <option
                  v-for="status in DEVELOPMENT_STATUSES"
                  :key="status"
                  :value="status"
                >
                  {{ DEVELOPMENT_STATUS_LABELS[status] }}
                </option>
              </select>
            </AdminField>

            <AdminField
              label="来源页"
              control-id="f-source"
              class="md:col-span-2"
              :error="shownErrors.sourceUrl"
              hint="官方页面或原始发布页，只接受 http(s) 完整链接；可以不填"
            >
              <input
                id="f-source"
                v-model="draft.sourceUrl"
                type="url"
                autocomplete="off"
                placeholder="https://…"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.sourceUrl)"
              />
            </AdminField>

            <AdminField
              label="视频 URL"
              control-id="f-video"
              :error="shownErrors.videoUrl"
              hint="可以不填；要填就填完整链接"
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
              label="一句话简介"
              control-id="f-short"
              class="md:col-span-2"
              :error="shownErrors.shortDescription"
              hint="显示在详情页标题下面，建议 40–80 个字；不填就不显示"
            >
              <input
                id="f-short"
                v-model="draft.shortDescription"
                type="text"
                autocomplete="off"
                placeholder="例如：以第一人称重述「被烧毁的宅邸」之夜。"
                :class="INPUT_CLASS"
                :aria-invalid="Boolean(shownErrors.shortDescription)"
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
            <AdminField
              label="其他名称"
              control-id="f-alt-titles"
              class="md:col-span-2"
              :error="shownErrors.altTitles"
              hint="缩写、旧标题、其他语言标题。会参与前台搜索，但不作为索引入口"
            >
              <AdminAltTitleEditor />
            </AdminField>

            <AdminField
              label="支持平台"
              control-id="f-platforms"
              class="md:col-span-2"
              :error="shownErrors.platforms"
              hint="从受控词表里选；没有需要的平台就到「玩法与机制」页新建"
            >
              <AdminVocabularyPicker collection="platforms" />
            </AdminField>
          </div>
        </AdminEditorSection>
        <!-- 玩法与机制（Phase 2）—— 与「标签」不是一回事：这里是受控词表 -->
        <AdminEditorSection
          title="玩法与机制"
          anchor="section-vocab"
          :changed="vocabChanged"
        >
          <div class="flex flex-col gap-10">
            <div>
              <div class="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <h3 class="swiss-meta font-bold">玩法类型</h3>
                <p class="swiss-meta text-black/45">第一个是主要玩法 · 最多 3 个</p>
              </div>
              <p class="mb-4 max-w-[78ch] font-sans text-xs leading-relaxed text-black/50">
                回答「核心游玩循环是什么」。有监控摄像头不等于传统守夜式 ——
                机制不能反推玩法类型；不确定就留空，不要用标签凑数。
              </p>
              <AdminVocabularyPicker
                collection="gameplayTypes"
                primary
                :error="shownErrors.gameplayTypes"
              />
            </div>

            <div class="border-t border-line pt-8">
              <div class="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <h3 class="swiss-meta font-bold">游戏机制</h3>
                <p class="swiss-meta text-black/45">最多 12 个</p>
              </div>
              <p class="mb-4 max-w-[78ch] font-sans text-xs leading-relaxed text-black/50">
                回答「玩家具体做什么」：监控摄像头、资源管理、潜行、解谜、自由移动等。
              </p>
              <AdminVocabularyPicker
                collection="mechanics"
                :error="shownErrors.mechanics"
              />
            </div>

            <p class="border-t border-line pt-6 font-sans text-xs leading-relaxed text-black/50">
              词表由「<RouterLink
                to="/admin/vocabulary"
                class="font-bold underline underline-offset-2 transition-colors duration-150 ease-out hover:text-accent"
              >
                玩法与机制
              </RouterLink>」页维护。作品编辑器只能选择已有词条，不能在这里新建 ——
              否则同一个概念会被写成好几个近义词。
            </p>
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
              hint="用在列表卡片和搜索结果里，建议 16:9 或更接近方形"
            />
            <AdminImageSlot
              field="bannerImage"
              :game-id="imageOwnerId"
              control-id="f-banner"
              label="Banner 宣传图"
              ratio="aspect-[21/9]"
              :error="shownErrors.bannerImage"
              hint="详情页顶部的大图，建议用 21:9 的横图"
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

        <!-- 关联作品（Phase 5）—— 有向边，反向文案由目标页派生 -->
        <AdminEditorSection
          title="关联作品"
          anchor="section-relations"
          :changed="relationChanged"
        >
          <AdminRelationEditor />
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
      class="mt-16 border border-accent px-6 py-6"
      aria-labelledby="danger-zone-title"
    >
      <p class="swiss-meta text-accent">危险操作</p>
      <h2 id="danger-zone-title" class="mt-2 font-sans text-lg font-bold">永久删除这条作品</h2>

      <p class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        删除会把 <span class="font-bold text-black">{{ game.id }}</span> 从数据仓里移除，
        并清掉只有它在用的上传图片。后台没法撤销；真要找回来，只能去数据仓的提交历史里回滚。
      </p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        如果只是不想让它出现在线上，用右栏「发布设置 → 下线」就行。下线不会删数据，随时可以恢复。
      </p>

      <div class="mt-5">
        <button type="button" :class="ACTION_DANGER" @click="openDelete">删除这条作品</button>
      </div>

      <!-- 二次确认弹窗：点「删除」后再确认一次，不再要求输入 id -->
      <AdminConfirmDialog
        :open="confirmingDelete"
        title="确认永久删除？"
        confirm-label="确认永久删除"
        :busy="deleting"
        :error="deleteError"
        @confirm="confirmDelete"
        @cancel="cancelDelete"
      >
        <p>
          会把《{{ game.title }}》（<span class="font-bold tracking-[0.08em]">{{
            game.id
          }}</span
          >）从数据仓里删掉，并清掉只有它在用的上传图片。
        </p>
        <p class="mt-3">
          这一步没法撤销，后台也找不回来。真要找回，只能去数据仓的提交历史里回滚。
          如果只是不想让它出现在线上，用右栏「发布设置 → 下线」就行；下线不删数据，随时可以恢复。
        </p>
      </AdminConfirmDialog>
    </section>
  </div>
</template>
