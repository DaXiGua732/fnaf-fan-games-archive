<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { readGameJoltCaptureZip } from '../../services/gamejoltCapture'
import {
  buildGameJoltDraftPatch,
  fetchGameJoltImport,
  importGameJoltImages,
  type GameJoltImportData,
  type GameJoltImportProgress,
} from '../../services/gamejoltImport'
import { IMAGE_LIMITS } from '../../types/admin'
import { slugify } from '../../utils/gameFactory'

/**
 * AdminGameJoltImport —— 从 GameJolt 半自动填充一条作品
 *
 * 只负责「抓取 → 预览 → 填进草稿 + 上传图片」。
 * **不自动保存**：导入结束后用户仍然要点右上角「保存」，
 * 这样与后台其余编辑行为一致，也避免误点直接改线上数据。
 *
 * 游戏文件（下载渠道）刻意不碰 —— 这是产品决定：资源仍然人工下载、上传、填链接。
 * 本组件也不会把 GameJolt 的下载地址当成网盘渠道，那会得到一个不可用的条目。
 */
const props = defineProps<{
  /** 编辑已有作品时是它的 id；新增时是标题 slug（与编辑器图片目录口径一致） */
  gameId: string
  isNew: boolean
}>()

const { draft, addImages, setImage } = useAdminGameDraftContext()
const { storage, uploadImage } = useAdminGames()

const input = ref('')
const fetching = ref(false)
const applying = ref(false)
const zipLoading = ref(false)
const zipInput = ref<HTMLInputElement | null>(null)
const zipName = ref('')
const zipImages = ref<Map<string, File> | null>(null)
const sourceLabel = ref('')
const previewCoverUrl = ref('')
const error = ref('')
const data = ref<GameJoltImportData | null>(null)
const warnings = ref<string[]>([])
const progress = ref<GameJoltImportProgress | null>(null)
const result = ref<{ uploaded: number; failed: number; notes: string[] } | null>(null)

const canApply = computed(
  () =>
    Boolean(data.value) &&
    storage.value === 'remote' &&
    !applying.value &&
    !zipLoading.value,
)

const imageSummary = computed(() => {
  const current = data.value
  if (!current) return ''
  const parts: string[] = []
  if (current.coverImage) parts.push('封面 1')
  if (current.bannerImage) parts.push('Banner 1')
  if (current.gallery.length) parts.push(`截图 ${current.gallery.length}`)
  return parts.length ? `GameJolt 图片：${parts.join(' · ')}` : 'GameJolt 没有提供图片'
})

const progressText = computed(() => {
  const current = progress.value
  if (!current || current.total === 0) return ''
  if (current.done >= current.total) return `已处理 ${current.total} 张图片`
  return `正在上传 ${current.label}（${Math.min(current.done + 1, current.total)}/${current.total}）`
})

const resultText = computed(() => {
  const current = result.value
  if (!current) return ''
  if (current.uploaded === 0) return '已填入表单，没有上传图片'
  const failed = current.failed > 0 ? `，${current.failed} 张失败` : ''
  return `已填入表单并上传 ${current.uploaded} 张图片${failed}`
})

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败'
}

function formatFetchedAt(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false })
}

function revokePreviewCover(): void {
  if (previewCoverUrl.value.startsWith('blob:')) {
    URL.revokeObjectURL(previewCoverUrl.value)
  }
}

function clearPreview(): void {
  revokePreviewCover()
  data.value = null
  warnings.value = []
  progress.value = null
  result.value = null
  zipImages.value = null
  zipName.value = ''
  sourceLabel.value = ''
  previewCoverUrl.value = ''
}

/** 统一接收两种来源（助手 / ZIP）的预览数据 */
function showPreview(
  fetched: GameJoltImportData,
  options: {
    source: string
    images: Map<string, File> | null
    extraWarnings?: string[]
  },
): void {
  revokePreviewCover()
  data.value = fetched
  warnings.value = [...new Set([...fetched.warnings, ...(options.extraWarnings ?? [])])]
  zipImages.value = options.images
  sourceLabel.value = options.source
  previewCoverUrl.value = fetched.coverImage

  if (options.images && fetched.coverImage) {
    const cover = options.images.get(fetched.coverImage)
    if (cover) previewCoverUrl.value = URL.createObjectURL(cover)
  }
}

async function onFetch(): Promise<void> {
  if (fetching.value || zipLoading.value || applying.value) return

  error.value = ''
  clearPreview()
  fetching.value = true

  try {
    const fetched = await fetchGameJoltImport(input.value)
    showPreview(fetched, { source: '来源：本机助手抓取', images: null })
    zipName.value = ''
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    fetching.value = false
  }
}

function openZipPicker(): void {
  zipInput.value?.click()
}

async function loadZip(file: File): Promise<void> {
  if (fetching.value || zipLoading.value || applying.value) return

  if (!file.name.toLowerCase().endsWith('.zip')) {
    error.value = '请选择扩展导出的 .zip 文件。'
    return
  }

  error.value = ''
  clearPreview()
  zipLoading.value = true

  try {
    const bundle = await readGameJoltCaptureZip(file)
    const fetchedAt = formatFetchedAt(bundle.manifest.fetchedAt)
    zipName.value = file.name
    showPreview(bundle.data, {
      source: fetchedAt ? `来源：扩展 ZIP · 抓取于 ${fetchedAt}` : '来源：扩展 ZIP',
      images: bundle.images,
      extraWarnings: bundle.warnings,
    })
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    zipLoading.value = false
  }
}

async function onZipChange(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  // 清空 value，用户才能连续选择同一个文件重试
  target.value = ''
  if (file) await loadZip(file)
}

async function onDrop(event: DragEvent): Promise<void> {
  const file = event.dataTransfer?.files?.[0]
  if (file) await loadZip(file)
}

async function onApply(): Promise<void> {
  const fetched = data.value
  if (!fetched || applying.value) return

  if (storage.value !== 'remote') {
    error.value = '还没登录（或正在用本地数据）：图片传不上去，请登录后再导入。'
    return
  }

  applying.value = true
  error.value = ''
  result.value = null

  try {
    const { patch, warnings: patchWarnings } = buildGameJoltDraftPatch(fetched, {
      releaseYear: draft.releaseYear,
      ipSeries: draft.ipSeries,
      engine: draft.engine,
      videoUrl: draft.videoUrl,
      shortDescription: draft.shortDescription,
      description: draft.description,
      tags: [...draft.tags],
    })

    // 先填文本：图片上传失败时，用户至少能看到抓到了什么。
    draft.title = patch.title
    draft.author = patch.author
    draft.releaseYear = patch.releaseYear
    draft.ipSeries = patch.ipSeries
    draft.engine = patch.engine
    draft.videoUrl = patch.videoUrl
    draft.shortDescription = patch.shortDescription
    draft.description = patch.description
    draft.tags = patch.tags

    warnings.value = [...new Set([...warnings.value, ...patchWarnings])]

    // 新增作品还没有 id，图片目录按标题 slug 走 —— 与编辑器 imageOwnerId 的口径一致。
    const uploadGameId = props.isNew ? slugify(patch.title) || props.gameId : props.gameId
    const localImages = zipImages.value
    const imageResult = await importGameJoltImages(fetched, {
      gameId: uploadGameId,
      storage: storage.value,
      galleryRoom: Math.max(0, IMAGE_LIMITS.maxGallery - draft.gallery.length),
      uploadImage,
      imageLoader: localImages
        ? (url) => {
            const file = localImages.get(url)
            if (!file) throw new Error('ZIP 里没有这张图片，请重新导出后再试。')
            return file
          }
        : undefined,
      onProgress: (next) => {
        progress.value = next
      },
    })

    if (imageResult.coverImage) setImage('coverImage', imageResult.coverImage)
    if (imageResult.bannerImage) setImage('bannerImage', imageResult.bannerImage)
    if (imageResult.gallery.length) addImages(imageResult.gallery)

    warnings.value = [...new Set([...warnings.value, ...imageResult.warnings])]
    result.value = {
      uploaded: imageResult.uploaded,
      failed: imageResult.failed,
      notes: imageResult.notes,
    }
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    applying.value = false
    progress.value = null
  }
}

function onClear(): void {
  if (applying.value) return
  error.value = ''
  clearPreview()
}

onUnmounted(revokePreviewCover)

const INPUT_CLASS =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-accent focus:outline-none'

const ACTION_BASE =
  'inline-flex items-center gap-3 border px-6 py-3 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.16em] transition-colors duration-150 ease-out'

const ACTION_PRIMARY = `${ACTION_BASE} border-black bg-black text-white hover:border-accent-surface hover:bg-accent-surface hover:text-on-accent disabled:cursor-not-allowed disabled:border-line disabled:bg-white disabled:text-black/30 disabled:hover:border-line disabled:hover:bg-white disabled:hover:text-black/30`

const ACTION_SECONDARY = `${ACTION_BASE} border-black bg-white hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30`
</script>

<template>
  <div>
    <p class="max-w-[78ch] font-sans text-xs leading-relaxed text-black/60">
      会自动填好标题、作者、年份、引擎、简介和图片。
      <span class="font-bold text-black">游戏文件不在自动导入范围内</span>，
      下载渠道还得你自己下载、上传并填写。
    </p>

    <!-- 方式一：浏览器扩展导出的 ZIP（运维主路径） -->
    <div
      class="mt-5 border border-black bg-surface p-5"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <p class="swiss-meta font-bold text-black">方式一 · 用扩展导出的 ZIP（推荐）</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/60">
        打开 GameJolt 的作品页，点右下角的「导出到 FNAF 档案」，再把下载好的 ZIP 拖到这里。
        不用装 Node，也不用一直开着电脑上的程序。
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <input
          id="gamejolt-zip"
          ref="zipInput"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          class="sr-only"
          :disabled="fetching || zipLoading || applying"
          @change="onZipChange"
        />
        <button
          type="button"
          :class="ACTION_SECONDARY"
          :disabled="fetching || zipLoading || applying"
          @click="openZipPicker"
        >
          {{ zipLoading ? '读取 ZIP 中…' : '选择 ZIP 文件' }}
        </button>
        <span v-if="zipName" class="font-sans text-xs text-black/60">
          已读取：{{ zipName }}
        </span>
        <span v-if="zipLoading" class="swiss-meta text-black/45">正在检查并解压…</span>
      </div>
    </div>

    <!-- 方式二：本机助手（开发 / 调试备用） -->
    <p class="mt-4 max-w-[78ch] border border-line bg-surface px-4 py-3 font-sans text-xs leading-relaxed text-black/60">
      方式二 · 本机助手（开发调试用）：在项目目录运行
      <code class="font-mono text-[11px] font-bold text-black">npm run gamejolt:helper</code>
      ，窗口别关，然后粘贴链接抓取。助手只负责读取 GameJolt 的公开信息，碰不到数据仓的令牌。
    </p>

    <div class="mt-3 flex flex-wrap items-stretch gap-3">
      <input
        id="gamejolt-url"
        v-model="input"
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="https://gamejolt.com/games/xxx/123456"
        :class="INPUT_CLASS"
        :disabled="fetching || zipLoading || applying"
        @keydown.enter.prevent="onFetch"
      />
      <button
        type="button"
        :class="ACTION_PRIMARY"
        :disabled="fetching || zipLoading || applying"
        @click="onFetch"
      >
        {{ fetching ? '抓取中…' : '抓取信息' }}
      </button>
    </div>

    <div v-if="error" class="mt-4 border border-accent px-4 py-3" role="alert" aria-live="assertive">
      <p class="font-sans text-xs leading-relaxed text-accent">{{ error }}</p>
    </div>

    <!-- ============ 抓取结果预览 ============ -->
    <div v-if="data" class="mt-6 border border-line">
      <div class="grid gap-5 p-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <div class="border border-line bg-surface">
          <img
            v-if="previewCoverUrl"
            :src="previewCoverUrl"
            alt="GameJolt 封面预览"
            class="aspect-video w-full object-cover"
            referrerpolicy="no-referrer"
          />
          <div v-else class="flex aspect-video items-center justify-center">
            <span class="swiss-meta text-black/35">无封面</span>
          </div>
        </div>

        <div class="min-w-0">
          <p class="swiss-meta text-black/45">GameJolt #{{ data.gameJoltId }}</p>
          <p v-if="sourceLabel" class="swiss-meta mt-1 text-black/45">{{ sourceLabel }}</p>
          <h3 class="mt-1 font-sans text-lg font-bold leading-tight">{{ data.title }}</h3>
          <p class="mt-1 font-sans text-xs text-black/60">
            by {{ data.author || '未知作者' }} · {{ data.releaseYear }} ·
            {{ data.engine || '引擎未知' }}
          </p>
          <p v-if="data.ipSeries" class="swiss-meta mt-2 text-black/50">
            IP 系列：{{ data.ipSeries }}
          </p>
          <p class="swiss-meta mt-2 text-black/50">{{ imageSummary }}</p>

          <p
            v-if="data.description"
            class="mt-3 max-h-32 overflow-auto whitespace-pre-wrap border-t border-line pt-3 font-sans text-xs leading-relaxed text-black/70"
          >
            {{ data.description }}
          </p>

          <a
            v-if="data.sourceUrl"
            :href="data.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-block font-sans text-xs font-bold underline underline-offset-4 hover:text-accent"
          >
            打开 GameJolt 原页
          </a>
        </div>
      </div>

      <div v-if="warnings.length" class="border-t border-line px-5 py-4">
        <p class="swiss-meta font-bold text-accent">需要注意</p>
        <ul class="mt-2 space-y-1">
          <li
            v-for="warning in warnings"
            :key="warning"
            class="font-sans text-xs leading-relaxed text-black/70"
          >
            · {{ warning }}
          </li>
        </ul>
      </div>

      <div class="border-t border-line px-5 py-4">
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" :class="ACTION_PRIMARY" :disabled="!canApply" @click="onApply">
            {{ applying ? '正在导入…' : '填入表单并上传图片' }}
          </button>
          <button type="button" :class="ACTION_SECONDARY" :disabled="applying" @click="onClear">
            取消预览
          </button>
        </div>

        <p v-if="progress" class="swiss-meta mt-3 text-black/60" role="status" aria-live="polite">
          {{ progressText }}
        </p>

        <p
          v-if="storage !== 'remote'"
          class="mt-3 font-sans text-xs leading-relaxed text-accent"
        >
          还没登录：可以先预览，但图片不会上传。请登录后再导入。
        </p>
        <p v-else class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/60">
          会覆盖标题、作者、年份、引擎、简介和标签，图片会马上传到数据仓。
          <span class="font-bold text-black">下载渠道和发布设置不会动。</span>
        </p>
      </div>
    </div>

    <!-- ============ 导入结果 ============ -->
    <div
      v-if="result"
      class="mt-4 border border-line border-l-4 border-l-accent px-5 py-4"
      role="status"
      aria-live="polite"
    >
      <p class="swiss-meta text-black/60">导入结果</p>
      <p class="mt-2 font-sans text-sm font-bold">{{ resultText }}</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        别忘了点右上角「保存」，改动才会写进数据仓。游戏下载资源还需要你手动补上。
      </p>
      <ul v-if="result.notes.length" class="mt-3 space-y-1">
        <li
          v-for="note in result.notes"
          :key="note"
          class="font-sans text-xs leading-relaxed text-black/60"
        >
          · {{ note }}
        </li>
      </ul>
    </div>
  </div>
</template>
