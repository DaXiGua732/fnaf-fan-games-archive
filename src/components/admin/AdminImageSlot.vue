<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { IMAGE_LIMITS, isLocalPreviewUrl } from '../../types/admin'
import { assetUrl } from '../../utils/asset'
import { aspectWarning, checkImageSize, readImageSize } from '../../utils/imageInspect'
import AdminField from './AdminField.vue'

/**
 * AdminImageSlot —— 单个图片位（封面 / Banner）
 *
 * 【Phase 16 起：真的会上传】
 * 登录后（`storage === 'remote'`）选图会**直接传到数据仓**，返回的完整外链写进数据。
 * 前台的 `assetUrl()` 会原样放行完整外链，所以前台无需任何改动。
 *
 * 未登录 / 本地模式没有可写的远端，只能给一个 `blob:` 预览 —— 它只在本页有效、
 * 刷新即失效。这类值会显著标注「本地临时预览 · 未上传」，绝不让人以为已经上传成功。
 */
const props = withDefaults(
  defineProps<{
    field: 'coverImage' | 'bannerImage'
    label: string
    controlId: string
    /** 该图片属于哪条作品 —— 决定它在数据仓里的目录 */
    gameId: string
    error?: string
    hint?: string
    /** 预览框比例（Tailwind aspect 类） */
    ratio?: string
  }>(),
  { error: '', hint: '', ratio: 'aspect-video' },
)

const { draft, setImage, clearImage } = useAdminGameDraftContext()
const { storage, uploadImage } = useAdminGames()

const value = computed<string>({
  get: () => draft[props.field],
  set: (next) => setImage(props.field, next),
})

const preview = computed(() => assetUrl(value.value))
const isLocal = computed(() => isLocalPreviewUrl(value.value))

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const notice = ref('')
/** 正在上传 —— 这期间要禁用入口，否则重复拖放会传上去好几份 */
const uploading = ref(false)
/** 刚上传成功（用于说明「Pages 还没跟上」这件事，避免被当成上传失败） */
const uploadedJustNow = ref(false)
/** 比例偏离的提示（不拦截） */
const ratioNotice = ref('')
/** 上一次上传失败的文件 —— 提供「重试」，不用让用户重新选一遍 */
const failedFile = ref<File | null>(null)

/**
 * 本组件自己创建的 blob 地址。
 * 只在「替换」与「卸载」时撤销 —— 撤销是必要的，否则一个会话里选十几次文件
 * 就会累积十几个最大 4MB 的 blob 常驻内存。
 */
let createdObjectUrl = ''

function releaseObjectUrl(): void {
  if (!createdObjectUrl) return
  URL.revokeObjectURL(createdObjectUrl)
  createdObjectUrl = ''
}

onUnmounted(releaseObjectUrl)

/** 这个图片位在数据仓里的位置标识 */
const slot = computed(() => (props.field === 'coverImage' ? 'cover' : 'banner'))

/**
 * 处理一个选中的文件：先校验，再决定「上传」还是「本地预览」。
 *
 * 校验顺序是有讲究的：类型 → 大小 → 尺寸。
 * 尺寸检查要先把图读成位图，比前两项贵得多，所以放在最后 ——
 * 一个 50 MB 的非图片文件不该被送去解码。
 */
async function handleFile(file: File): Promise<void> {
  ratioNotice.value = ''
  failedFile.value = null

  if (!file.type.startsWith('image/')) {
    notice.value = '只接受图片文件'
    return
  }
  if (file.size > IMAGE_LIMITS.maxFileBytes) {
    notice.value = `图片不能超过 ${Math.round(IMAGE_LIMITS.maxFileBytes / 1024 / 1024)} MB`
    return
  }

  // 尺寸检查（本地模式也做 —— 至少别让人存下一个糊成一片的地址）
  let box
  try {
    box = await readImageSize(file)
  } catch {
    notice.value = '这个文件读不出图片尺寸，可能已经损坏。'
    return
  }
  const sizeProblem = checkImageSize(box, slot.value)
  if (sizeProblem) {
    notice.value = sizeProblem
    return
  }
  // 比例只提示、不拦 —— 见 utils/imageInspect.ts 的说明
  ratioNotice.value = aspectWarning(box, slot.value)

  // 本地模式：没有可写的远端，只能给一个本页有效的预览
  if (storage.value !== 'remote') {
    releaseObjectUrl()
    createdObjectUrl = URL.createObjectURL(file)
    value.value = createdObjectUrl
    notice.value = ''
    return
  }

  // 远程模式：真的上传到数据仓
  uploading.value = true
  notice.value = ''
  uploadedJustNow.value = false
  try {
    releaseObjectUrl()
    value.value = await uploadImage(file, { gameId: props.gameId, slot: slot.value })
    uploadedJustNow.value = true
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '上传失败'
    // 记下文件，让用户能一键重试而不是重新选一遍
    failedFile.value = file
  } finally {
    uploading.value = false
  }
}

async function acceptFiles(files: FileList | null | undefined): Promise<void> {
  const file = files?.[0]
  if (file) await handleFile(file)
}

/** 重试上一次失败的那个文件 */
async function retry(): Promise<void> {
  if (failedFile.value) await handleFile(failedFile.value)
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  void acceptFiles(input.files)
  // 清空以便连续选同一个文件也能触发 change
  input.value = ''
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  void acceptFiles(event.dataTransfer?.files)
}

function openPicker(): void {
  fileInput.value?.click()
}

function onUrlInput(event: Event): void {
  const next = (event.target as HTMLInputElement).value
  // 手动改了地址就不该再持有本机文件的临时地址了
  if (createdObjectUrl && next !== createdObjectUrl) releaseObjectUrl()
  value.value = next
  notice.value = ''
}

function clear(): void {
  releaseObjectUrl()
  clearImage(props.field)
  notice.value = ''
}

const URL_INPUT =
  'min-w-[220px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'
</script>

<template>
  <AdminField :label="label" :control-id="`${controlId}-url`" :error="error" :hint="hint">
    <!-- 预览 -->
    <div class="border border-[#cccccc] bg-[#f9f9f9]">
      <img
        v-if="value"
        :src="preview"
        :alt="`${label} 预览`"
        :class="['w-full object-contain', ratio]"
      />
      <div v-else :class="['flex items-center justify-center', ratio]">
        <span class="swiss-meta text-black/35">尚未设置</span>
      </div>
    </div>

    <p v-if="uploading" class="swiss-meta mt-2 text-black/60" role="status">上传中……</p>

    <p v-else-if="uploadedJustNow" class="swiss-meta mt-2 text-black/60" role="status">
      已上传到数据仓 —— Pages 大约 1 分钟后才会提供这张图，期间预览可能显示不出来
    </p>

    <p v-else-if="isLocal" class="swiss-meta mt-2 font-bold text-[#ff0000]">
      本地临时预览 · 未上传（刷新即失效）
    </p>

    <p v-if="ratioNotice && !uploading" class="swiss-meta mt-2 text-black/60">
      {{ ratioNotice }}
    </p>

    <!-- 拖放 / 选择文件 -->
    <div
      :class="[
        'mt-3 cursor-pointer border px-4 py-5 transition-colors duration-150 ease-out',
        dragging ? 'border-black bg-[#f9f9f9]' : 'border-[#cccccc] hover:border-black',
      ]"
      role="button"
      tabindex="0"
      :aria-disabled="uploading"
      @click="uploading ? undefined : openPicker()"
      @keydown.enter.prevent="uploading ? undefined : openPicker()"
      @keydown.space.prevent="uploading ? undefined : openPicker()"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p class="font-sans text-xs font-bold">
        {{
          uploading
            ? '正在上传到数据仓……'
            : dragging
              ? '松手即上传'
              : '点击选择文件，或把图片拖到这里'
        }}
      </p>
      <p class="swiss-meta mt-2 text-black/45">
        {{
          storage === 'remote'
            ? '文件会上传到数据仓，返回的完整地址写进本条作品 —— 保存后前台即可使用'
            : '未登录：文件只做本地预览、不会上传（刷新即失效）'
        }}
      </p>
      <input
        :id="`${controlId}-file`"
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onPick"
      />
    </div>

    <!-- 直接填地址 -->
    <label class="swiss-meta mb-2 mt-4 block text-black/60" :for="`${controlId}-url`">
      或直接填图片地址
    </label>
    <div class="flex flex-wrap items-stretch gap-3">
      <input
        :id="`${controlId}-url`"
        type="text"
        autocomplete="off"
        placeholder="/images/xxx-cover.svg 或 https://…"
        :value="value"
        :class="URL_INPUT"
        @input="onUrlInput"
      />
      <button
        type="button"
        class="rounded-none border border-black bg-white px-5 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
        :disabled="!value"
        @click="clear"
      >
        清除
      </button>
    </div>

    <div v-if="notice" class="mt-2 flex flex-wrap items-baseline gap-4" role="alert">
      <p class="font-sans text-xs text-[#ff0000]">{{ notice }}</p>
      <button
        v-if="failedFile"
        type="button"
        class="rounded-none border border-black bg-white px-3 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white"
        @click="retry"
      >
        重试
      </button>
    </div>
  </AdminField>
</template>
