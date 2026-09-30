<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { useAdminGames } from '../../composables/useAdminGames'
import { IMAGE_LIMITS, isValidImageRef, normalizeImageRef } from '../../types/admin'
import { assetUrl } from '../../utils/asset'
import { aspectWarning, checkImageSize, readImageSize } from '../../utils/imageInspect'

/**
 * AdminGalleryEditor —— 图库编辑
 *
 * 编辑的是**草稿**里的 gallery（点保存才生效，与其它字段一致）。
 * 数组顺序就是前台展示顺序，所以提供上移 / 下移而不是排序。
 *
 * 【Phase 16 起】登录后选图会**逐张上传到数据仓**，拿到真实地址再进草稿。
 * 未登录 / 本地模式没有可写的远端，只能给 `blob:` 临时预览（会显著标注未上传）。
 */
const props = defineProps<{
  /** 该组图属于哪条作品 —— 决定它们在数据仓里的目录 */
  gameId: string
}>()

const { draftImages, canAddImage, addImages, removeImage, moveImage } =
  useAdminGameDraftContext()
const { storage, uploadImage } = useAdminGames()

const urlDraft = ref('')
const dragging = ref(false)
const notice = ref('')
/** 正在上传 —— 期间禁用入口，避免重复拖放传上去好几份 */
const uploading = ref(false)
/**
 * 批量上传的张数进度。
 *
 * 【为什么是「第 N / M 张」而不是百分比】`fetch` 不暴露上传进度，
 * 要拿字节级进度就得换成 XHR —— 那会引入第二条 HTTP 路径，
 * 连带测试桩也要写两份。为 4 MB 上限的图片付这个复杂度不划算，
 * 而「第几张」对批量上传已经传达了同样的信息：它在动、还要多久。
 */
const uploadProgress = ref({ done: 0, total: 0 })
/** 失败的文件 —— 提供一键重试，不用让用户重新选一遍 */
const failedFiles = ref<File[]>([])
/** 比例偏离的提示（不拦截） */
const ratioNotes = ref<string[]>([])
const picker = ref<HTMLInputElement | null>(null)

function openPicker(): void {
  if (uploading.value) return
  picker.value?.click()
}

/** 重试失败的那几张 —— 用 DataTransfer 拼成 FileList，复用同一条处理路径 */
async function retryFailed(): Promise<void> {
  if (uploading.value || failedFiles.value.length === 0) return
  const transfer = new DataTransfer()
  for (const file of failedFiles.value) transfer.items.add(file)
  failedFiles.value = []
  await trackFiles(transfer.files)
}

/** 本组件创建过的 blob 地址，卸载时统一撤销，避免大图常驻内存 */
const objectUrls = new Set<string>()

onUnmounted(() => {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
})

const remaining = computed(() => IMAGE_LIMITS.maxGallery - draftImages.value.length)

/** 加入一批本机文件。上限先算再建地址，避免创建出一堆用不上的 blob */
async function trackFiles(files: FileList | null | undefined): Promise<void> {
  if (!files || files.length === 0) return

  let room = remaining.value
  if (room <= 0) {
    notice.value = `图库最多 ${IMAGE_LIMITS.maxGallery} 张，请先删掉一些`
    return
  }

  const usable = Array.from(files).filter(
    (file) => file.type.startsWith('image/') && file.size <= IMAGE_LIMITS.maxFileBytes,
  )

  // —— 远程模式：逐张上传，拿到真实地址再进草稿 ——
  if (storage.value === 'remote') {
    uploading.value = true
    notice.value = ''
    ratioNotes.value = []
    failedFiles.value = []
    uploadProgress.value = { done: 0, total: usable.length }

    const accepted: string[] = []
    let skipped = Array.from(files).length - usable.length

    try {
      for (const file of usable) {
        if (room <= 0) {
          skipped += 1
          continue
        }

        // 尺寸检查放上传前 —— 别把一张 200×100 的图传上去再发现问题
        let box
        try {
          box = await readImageSize(file)
        } catch {
          skipped += 1
          notice.value = `有一张图读不出尺寸（${file.name}），已跳过。`
          continue
        }
        const sizeProblem = checkImageSize(box, 'gallery')
        if (sizeProblem) {
          skipped += 1
          notice.value = `${file.name}：${sizeProblem}`
          continue
        }
        const ratioNote = aspectWarning(box, 'gallery')
        if (ratioNote) ratioNotes.value.push(`${file.name}：${ratioNote}`)

        uploadProgress.value = { ...uploadProgress.value, done: uploadProgress.value.done + 1 }
        try {
          accepted.push(await uploadImage(file, { gameId: props.gameId, slot: 'gallery' }))
          room -= 1
        } catch (error) {
          skipped += 1
          failedFiles.value.push(file)
          // 失败原因直接说给用户听（多半是令牌权限或网络），不要吞掉
          notice.value = error instanceof Error ? error.message : '上传失败'
        }
      }
    } finally {
      uploading.value = false
    }

    const added = addImages(accepted)
    if (failedFiles.value.length === 0) {
      notice.value =
        skipped > 0
          ? `已上传 ${added} 张，跳过 ${skipped} 张（非图片 / 超 ${Math.round(IMAGE_LIMITS.maxFileBytes / 1024 / 1024)}MB / 尺寸不合格 / 超出上限）`
          : `已上传 ${added} 张到数据仓`
    }
    return
  }

  // —— 本地模式：没有可写的远端，只能给本页有效的预览 ——
  const accepted: string[] = []
  let skipped = 0

  for (const file of Array.from(files)) {
    if (room <= 0) {
      skipped += 1
      continue
    }
    if (!file.type.startsWith('image/')) {
      skipped += 1
      continue
    }
    if (file.size > IMAGE_LIMITS.maxFileBytes) {
      skipped += 1
      continue
    }
    // 本地模式也做尺寸检查：至少别让人存下一个糊成一片的地址
    try {
      const box = await readImageSize(file)
      const sizeProblem = checkImageSize(box, 'gallery')
      if (sizeProblem) {
        skipped += 1
        notice.value = `${file.name}：${sizeProblem}`
        continue
      }
    } catch {
      skipped += 1
      notice.value = `有一张图读不出尺寸（${file.name}），已跳过。`
      continue
    }

    const url = URL.createObjectURL(file)
    objectUrls.add(url)
    accepted.push(url)
    room -= 1
  }

  const added = addImages(accepted)
  notice.value =
    skipped > 0
      ? `已加入 ${added} 张，跳过 ${skipped} 张（非图片 / 超 ${Math.round(IMAGE_LIMITS.maxFileBytes / 1024 / 1024)}MB / 超出上限）`
      : ''
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  void trackFiles(input.files)
  input.value = ''
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  void trackFiles(event.dataTransfer?.files)
}

function addFromInput(): void {
  const ref = normalizeImageRef(urlDraft.value)
  if (!ref) return

  if (ref.length > IMAGE_LIMITS.maxLength) {
    notice.value = `图片地址不能超过 ${IMAGE_LIMITS.maxLength} 个字符`
    return
  }
  if (!isValidImageRef(ref)) {
    notice.value = '请填写站内路径（以 / 开头）或 http(s) 图片地址'
    return
  }
  if (draftImages.value.includes(ref)) {
    notice.value = '这张图已经在图库里了'
    return
  }
  if (!canAddImage.value) {
    notice.value = `图库最多 ${IMAGE_LIMITS.maxGallery} 张，请先删掉一些`
    return
  }

  addImages([ref])
  urlDraft.value = ''
  notice.value = ''
}

function forget(url: string): void {
  if (!objectUrls.has(url)) return
  URL.revokeObjectURL(url)
  objectUrls.delete(url)
}

function remove(index: number): void {
  const target = draftImages.value[index]
  if (target) forget(target)
  removeImage(index)
  notice.value = ''
}

const TILE_BUTTON =
  'rounded-none border border-[#cccccc] bg-white px-2 py-1 font-sans text-[10px] font-bold ' +
  'uppercase tracking-[0.1em] transition-colors duration-150 ease-out hover:border-black ' +
  'disabled:cursor-not-allowed disabled:text-black/25 disabled:hover:border-[#cccccc]'

const SMALL_BUTTON =
  'rounded-none border border-black bg-white px-5 py-3 font-sans text-[11px] font-bold ' +
  'uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white ' +
  'disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30'
</script>

<template>
  <div>
    <!-- ============ 已有图片 ============ -->
    <div v-if="draftImages.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <figure
        v-for="(image, index) in draftImages"
        :key="image"
        class="border border-[#cccccc]"
      >
        <div class="border-b border-[#cccccc] bg-[#f9f9f9]">
          <img
            :src="assetUrl(image)"
            :alt="`图库第 ${index + 1} 张`"
            class="aspect-video w-full object-contain"
          />
        </div>

        <figcaption class="px-3 py-3">
          <p class="swiss-meta text-black/45">NO.{{ String(index + 1).padStart(2, '0') }}</p>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              :class="TILE_BUTTON"
              :disabled="index === 0"
              :aria-label="`把第 ${index + 1} 张上移`"
              @click="moveImage(index, -1)"
            >
              上移
            </button>
            <button
              type="button"
              :class="TILE_BUTTON"
              :disabled="index === draftImages.length - 1"
              :aria-label="`把第 ${index + 1} 张下移`"
              @click="moveImage(index, 1)"
            >
              下移
            </button>
            <a
              :href="assetUrl(image)"
              target="_blank"
              rel="noopener noreferrer"
              class="font-sans text-[10px] font-bold uppercase tracking-[0.1em] transition-colors duration-150 ease-out hover:text-[#ff0000]"
            >
              查看 &#8599;
            </a>
            <button
              type="button"
              class="ml-auto font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-[#ff0000] transition-colors duration-150 ease-out hover:text-black"
              :aria-label="`删除第 ${index + 1} 张`"
              @click="remove(index)"
            >
              删除
            </button>
          </div>
        </figcaption>
      </figure>
    </div>

    <p v-else class="swiss-meta text-black/35">图库还是空的</p>

    <!-- ============ 添加 ============ -->
    <div
      :class="[
        'mt-5 cursor-pointer border px-4 py-5 transition-colors duration-150 ease-out',
        dragging ? 'border-black bg-[#f9f9f9]' : 'border-[#cccccc] hover:border-black',
      ]"
      role="button"
      tabindex="0"
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p class="font-sans text-xs font-bold">
        {{
          uploading
            ? `正在上传第 ${uploadProgress.done} / ${uploadProgress.total} 张……`
            : dragging
              ? '松手即上传'
              : '点击选择图片（可多选），或把图片拖到这里'
        }}
      </p>
      <p class="swiss-meta mt-2 text-black/45">
        {{
          storage === 'remote'
            ? '逐张上传到数据仓，返回的完整地址进本条作品 —— 保存后前台即可使用'
            : '未登录：文件只做本地预览、不会上传（刷新即失效）'
        }}
      </p>
      <input
        id="gallery-file"
        ref="picker"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onPick"
      />
    </div>

    <label class="swiss-meta mb-2 mt-4 block text-black/60" for="gallery-url">
      或直接填图片地址
    </label>
    <div class="flex flex-wrap items-stretch gap-3">
      <input
        id="gallery-url"
        v-model="urlDraft"
        type="text"
        autocomplete="off"
        placeholder="/images/xxx-banner.svg 或 https://…"
        class="min-w-[220px] flex-1 rounded-none border border-black bg-white px-4 py-3 font-sans text-sm transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none"
        @keyup.enter="addFromInput"
      />
      <button
        type="button"
        :class="SMALL_BUTTON"
        :disabled="!urlDraft.trim() || !canAddImage"
        @click="addFromInput"
      >
        加入图片
      </button>
    </div>

    <div v-if="notice" class="mt-3 flex flex-wrap items-baseline gap-4" role="alert">
      <p class="font-sans text-xs text-[#ff0000]">{{ notice }}</p>
      <button
        v-if="failedFiles.length > 0"
        type="button"
        class="rounded-none border border-black bg-white px-3 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white"
        @click="retryFailed"
      >
        重试这 {{ failedFiles.length }} 张
      </button>
    </div>

    <!-- 比例偏离只提示、不拦 —— 见 utils/imageInspect.ts -->
    <ul v-if="ratioNotes.length > 0" class="mt-3 flex flex-col gap-1">
      <li v-for="note in ratioNotes" :key="note" class="swiss-meta text-black/60">{{ note }}</li>
    </ul>
    <p v-else class="mt-3 font-sans text-xs text-black/45">
      {{ draftImages.length }} / {{ IMAGE_LIMITS.maxGallery }} 张 · 顺序即前台展示顺序
    </p>
  </div>
</template>
