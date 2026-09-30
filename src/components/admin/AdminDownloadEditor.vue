<script setup lang="ts">
import { ref } from 'vue'
import { useAdminGameDraftContext } from '../../composables/useAdminGameDraft'
import { DOWNLOAD_LIMITS } from '../../types/admin'
import AdminField from './AdminField.vue'

/**
 * AdminDownloadEditor —— 下载渠道编辑
 *
 * 每一行是「服务商 / 下载地址 / 提取码」，支持增删与上下移。
 * 行顺序即前台展示顺序（前台的 DownloadPanel 按数组顺序渲染）。
 *
 * 编辑的是**草稿**，点保存才写入目录。
 *
 * 【为什么逐行校验而不复用 DraftErrors】下载是数组，一个扁平的错误记录装不下，
 * 所以深模块单独提供 `downloadErrors`（与行一一对应），并且 `isValid` 会一起判断。
 */
const {
  draft,
  touched,
  draftDownloads,
  downloadErrors,
  canAddDownload,
  addDownload,
  removeDownload,
  moveDownload,
} = useAdminGameDraftContext()

const notice = ref('')

function add(): void {
  if (!canAddDownload.value) {
    notice.value = `最多 ${DOWNLOAD_LIMITS.maxPerGame} 个渠道`
    return
  }
  addDownload()
  notice.value = ''
}

function move(index: number, delta: -1 | 1): void {
  moveDownload(index, delta)
  notice.value = ''
}

function remove(index: number): void {
  removeDownload(index)
  notice.value = ''
}

/**
 * 是否显示某一行的错误。
 * 刚点「添加渠道」得到的空白行不该立刻飘红 —— 那是噪音，不是反馈。
 * 规则：提交过一次 → 全显示；否则只在「已经开始填了」的行上显示。
 */
function showError(index: number): boolean {
  const message = downloadErrors.value[index] ?? ''
  if (!message) return false
  if (touched.value) return true
  const link = draft.downloads[index]
  if (!link) return false
  return Boolean(link.provider.trim() || link.url.trim() || link.password.trim())
}

const INPUT_CLASS =
  'w-full rounded-none border border-black bg-white px-4 py-3 font-sans text-sm ' +
  'transition-colors duration-150 ease-out placeholder:text-black/35 focus:border-[#ff0000] focus:outline-none'

const TILE_BUTTON =
  'rounded-none border border-[#cccccc] bg-white px-3 py-1 font-sans text-[10px] font-bold ' +
  'uppercase tracking-[0.1em] transition-colors duration-150 ease-out hover:border-black ' +
  'disabled:cursor-not-allowed disabled:text-black/25 disabled:hover:border-[#cccccc]'
</script>

<template>
  <div>
    <!-- ============ 渠道列表 ============ -->
    <div v-if="draft.downloads.length" class="flex flex-col gap-5">
      <div v-for="(link, index) in draft.downloads" :key="index" class="border border-[#cccccc]">
        <header
          class="flex flex-wrap items-center justify-between gap-3 border-b border-[#cccccc] px-4 py-3"
        >
          <span class="swiss-meta text-black/45">
            NO.{{ String(index + 1).padStart(2, '0') }}
          </span>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              :class="TILE_BUTTON"
              :disabled="index === 0"
              :aria-label="`把第 ${index + 1} 个渠道上移`"
              @click="move(index, -1)"
            >
              上移
            </button>
            <button
              type="button"
              :class="TILE_BUTTON"
              :disabled="index === draft.downloads.length - 1"
              :aria-label="`把第 ${index + 1} 个渠道下移`"
              @click="move(index, 1)"
            >
              下移
            </button>
            <button
              type="button"
              class="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-[#ff0000] transition-colors duration-150 ease-out hover:text-black"
              :aria-label="`删除第 ${index + 1} 个渠道`"
              @click="remove(index)"
            >
              删除
            </button>
          </div>
        </header>

        <div class="grid gap-4 px-4 py-5 md:grid-cols-3">
          <AdminField label="服务商" :control-id="`dl-${index}-provider`" required>
            <input
              :id="`dl-${index}-provider`"
              v-model="link.provider"
              type="text"
              autocomplete="off"
              placeholder="如 123云盘"
              :class="INPUT_CLASS"
            />
          </AdminField>

          <AdminField label="下载地址" :control-id="`dl-${index}-url`" required class="md:col-span-2">
            <input
              :id="`dl-${index}-url`"
              v-model="link.url"
              type="text"
              autocomplete="off"
              placeholder="https://…"
              :class="INPUT_CLASS"
            />
          </AdminField>

          <AdminField
            label="提取码"
            :control-id="`dl-${index}-password`"
            hint="没有就留空"
          >
            <input
              :id="`dl-${index}-password`"
              v-model="link.password"
              type="text"
              autocomplete="off"
              placeholder="可留空"
              :class="INPUT_CLASS"
            />
          </AdminField>
        </div>

        <p
          v-if="showError(index)"
          class="border-t border-[#cccccc] px-4 py-3 font-sans text-xs text-[#ff0000]"
          role="alert"
        >
          {{ downloadErrors[index] }}
        </p>
      </div>
    </div>

    <p v-else class="swiss-meta text-black/35">还没有下载渠道</p>

    <!-- ============ 添加 ============ -->
    <button
      type="button"
      class="mt-5 rounded-none border border-black bg-white px-5 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:border-[#cccccc] disabled:text-black/30 disabled:hover:bg-white disabled:hover:text-black/30"
      :disabled="!canAddDownload"
      @click="add"
    >
      添加下载渠道
    </button>

    <p v-if="notice" class="mt-3 font-sans text-xs text-[#ff0000]" role="alert">{{ notice }}</p>
    <!--
      注意：这里的静态提示**不要**和 validateDownload 的错误文案用同一句话。
      否则一行出错时用户会在同一屏里看到两遍完全相同的句子，分不清哪句是「提示」哪句是「报错」。
    -->
    <p v-else class="mt-3 font-sans text-xs text-black/45">
      {{ draftDownloads.length }} / {{ DOWNLOAD_LIMITS.maxPerGame }} 个渠道 · 顺序即前台展示顺序 ·
      下载地址需以 http 或 https 开头
    </p>
  </div>
</template>
