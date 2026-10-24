<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
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
const error = ref('')
const data = ref<GameJoltImportData | null>(null)
const warnings = ref<string[]>([])
const progress = ref<GameJoltImportProgress | null>(null)
const result = ref<{ uploaded: number; failed: number; notes: string[] } | null>(null)

const canApply = computed(
  () => Boolean(data.value) && storage.value === 'remote' && !applying.value,
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

async function onFetch(): Promise<void> {
  if (fetching.value || applying.value) return

  error.value = ''
  result.value = null
  progress.value = null
  warnings.value = []
  data.value = null
  fetching.value = true

  try {
    const fetched = await fetchGameJoltImport(input.value)
    data.value = fetched
    warnings.value = [...fetched.warnings]
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    fetching.value = false
  }
}

async function onApply(): Promise<void> {
  const fetched = data.value
  if (!fetched || applying.value) return

  if (storage.value !== 'remote') {
    error.value = '未登录 / 本机模式：图片无法上传。请先登录后再导入。'
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
    const imageResult = await importGameJoltImages(fetched, {
      gameId: uploadGameId,
      storage: storage.value,
      galleryRoom: Math.max(0, IMAGE_LIMITS.maxGallery - draft.gallery.length),
      uploadImage,
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
  data.value = null
  warnings.value = []
  error.value = ''
  progress.value = null
  result.value = null
}

const INPUT_CLASS =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'

const ACTION_BASE =
  'inline-flex items-center gap-3 border px-6 py-3 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.16em] transition-colors duration-150 ease-out'

const ACTION_PRIMARY = `${ACTION_BASE} border-black bg-black text-white hover:border-[#ff0000] hover:bg-[#ff0000] disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:bg-white disabled:text-black/30 disabled:hover:border-[#cccccc] disabled:hover:bg-white disabled:hover:text-black/30`

const ACTION_SECONDARY = `${ACTION_BASE} border-black bg-white hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30`
</script>

<template>
  <div>
    <p class="max-w-[78ch] font-sans text-xs leading-relaxed text-black/60">
      粘贴 GameJolt 作品页链接，自动抓取标题、作者、年份、引擎、简介与图片。
      <span class="font-bold text-black">游戏文件不在自动导入范围内</span>
      —— 下载渠道仍需你手动下载、上传并填写。
    </p>

    <p class="mt-3 max-w-[78ch] border border-[#cccccc] bg-[#f9f9f9] px-4 py-3 font-sans text-xs leading-relaxed text-black/60">
      抓取需要本机助手：在项目目录运行
      <code class="font-mono text-[11px] font-bold text-black">npm run gamejolt:helper</code>
      ，保持窗口开启。助手只代理 GameJolt 元数据，不会接触数据仓令牌。
    </p>

    <div class="mt-5 flex flex-wrap items-stretch gap-3">
      <input
        id="gamejolt-url"
        v-model="input"
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="https://gamejolt.com/games/xxx/123456"
        :class="INPUT_CLASS"
        :disabled="fetching || applying"
        @keydown.enter.prevent="onFetch"
      />
      <button
        type="button"
        :class="ACTION_PRIMARY"
        :disabled="fetching || applying"
        @click="onFetch"
      >
        {{ fetching ? '抓取中…' : '抓取信息' }}
      </button>
    </div>

    <div v-if="error" class="mt-4 border border-[#ff0000] px-4 py-3" role="alert" aria-live="assertive">
      <p class="font-sans text-xs leading-relaxed text-[#ff0000]">{{ error }}</p>
    </div>

    <!-- ============ 抓取结果预览 ============ -->
    <div v-if="data" class="mt-6 border border-[#cccccc]">
      <div class="grid gap-5 p-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <div class="border border-[#cccccc] bg-[#f9f9f9]">
          <img
            v-if="data.coverImage"
            :src="data.coverImage"
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
            class="mt-3 max-h-32 overflow-auto whitespace-pre-wrap border-t border-[#e5e5e5] pt-3 font-sans text-xs leading-relaxed text-black/70"
          >
            {{ data.description }}
          </p>

          <a
            v-if="data.sourceUrl"
            :href="data.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-3 inline-block font-sans text-xs font-bold underline underline-offset-4 hover:text-[#ff0000]"
          >
            打开 GameJolt 原页
          </a>
        </div>
      </div>

      <div v-if="warnings.length" class="border-t border-[#cccccc] px-5 py-4">
        <p class="swiss-meta font-bold text-[#ff0000]">需要注意</p>
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

      <div class="border-t border-[#cccccc] px-5 py-4">
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
          class="mt-3 font-sans text-xs leading-relaxed text-[#ff0000]"
        >
          未登录：可以预览，但图片不会上传。请先登录后再导入。
        </p>
        <p v-else class="mt-3 max-w-[78ch] font-sans text-xs leading-relaxed text-black/60">
          会覆盖标题、作者、年份、引擎、简介与标签；图片会立即上传到数据仓。
          <span class="font-bold text-black">下载渠道和发布设置不会改动。</span>
        </p>
      </div>
    </div>

    <!-- ============ 导入结果 ============ -->
    <div
      v-if="result"
      class="mt-4 border border-[#cccccc] border-l-4 border-l-[#ff0000] px-5 py-4"
      role="status"
      aria-live="polite"
    >
      <p class="swiss-meta text-black/60">导入结果</p>
      <p class="mt-2 font-sans text-sm font-bold">{{ resultText }}</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        还需要点右上角「保存」才会写入数据仓。游戏下载资源请手动补充。
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
