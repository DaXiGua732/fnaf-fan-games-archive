<script setup lang="ts">
import { ref } from 'vue'
import Button from './Button.vue'
import type { DownloadLink } from '../types/game'
import { copyText } from '../utils/clipboard'

/**
 * DownloadPanel —— 资源下载核心区
 *
 * Swiss 约束：
 *  - 下载按钮使用 Button 的 solid 变体：黑底白字直角，悬停整块转 #ff0000
 *  - 提取码【绝对不能】用等宽字体（font-mono 属违规 token），
 *    改用无衬线 + 大字距（tracking）来获得「码」的可读性
 *  - 行与行之间用 1px 网格线分割，不用卡片和阴影
 */
defineProps<{ downloads: DownloadLink[] }>()

type CopyStatus = 'copied' | 'failed'

const copyState = ref<{ index: number; status: CopyStatus } | null>(null)
let resetTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 复制提取码。
 * 无论成功还是失败都必须给出可见反馈——静默失败会让人以为按钮坏了。
 */
async function copyPassword(link: DownloadLink, index: number): Promise<void> {
  if (!link.password) return

  const succeeded = await copyText(link.password)
  copyState.value = { index, status: succeeded ? 'copied' : 'failed' }

  if (resetTimer !== null) clearTimeout(resetTimer)
  resetTimer = setTimeout(
    () => {
      copyState.value = null
    },
    succeeded ? 1800 : 5000,
  )
}

function copyLabel(index: number): string {
  const state = copyState.value
  if (!state || state.index !== index) return '复制'
  return state.status === 'copied' ? '已复制' : '复制失败'
}

function isFailed(index: number): boolean {
  const state = copyState.value
  return state !== null && state.index === index && state.status === 'failed'
}
</script>

<template>
  <section>
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-black pb-4">
      <h2 class="font-sans text-2xl font-bold uppercase tracking-tight">下载</h2>
      <p class="swiss-meta text-black/60">共 {{ downloads.length }} 个渠道</p>
    </div>

    <p class="mb-10 max-w-[68ch] font-sans text-xs leading-relaxed text-black/60">
      以下链接均指向第三方网盘，本站不存储、不分发任何游戏文件。部分网盘需要提取码：
      点击「复制」写入剪贴板；若浏览器限制了剪贴板权限，直接点击提取码即可全选后手动复制。
    </p>

    <ul class="border-t border-black">
      <li
        v-for="(link, index) in downloads"
        :key="`${link.provider}-${index}`"
        class="grid gap-6 border-b border-[#cccccc] py-8 md:grid-cols-[minmax(0,1fr)_260px] md:items-center"
      >
        <div>
          <p class="font-sans text-sm font-bold uppercase tracking-[0.16em]">{{ link.provider }}</p>

          <div v-if="link.password" class="mt-4">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
              <span class="swiss-meta text-black/60">提取码</span>
              <span
                class="cursor-text select-all border border-[#cccccc] px-3 py-1 font-sans text-sm font-bold tracking-[0.34em]"
                title="点击可全选"
              >
                {{ link.password }}
              </span>
              <button
                type="button"
                class="swiss-meta border px-3 py-1 transition-colors duration-150 ease-out"
                :class="
                  isFailed(index)
                    ? 'border-[#ff0000] text-[#ff0000]'
                    : 'border-[#cccccc] hover:border-[#ff0000] hover:text-[#ff0000]'
                "
                @click="copyPassword(link, index)"
              >
                {{ copyLabel(index) }}
              </button>
            </div>

            <p
              v-if="isFailed(index)"
              class="mt-3 font-sans text-xs font-bold text-[#ff0000]"
              role="status"
            >
              当前浏览器环境禁止自动写入剪贴板，请点击上方提取码全选后手动复制。
            </p>
          </div>

          <p v-else class="mt-4 font-sans text-xs leading-relaxed text-black/50">
            该渠道无需提取码，直接下载即可。
          </p>
        </div>

        <Button variant="solid" size="lg" block :href="link.url" target="_blank">
          {{ link.provider }}下载
        </Button>
      </li>
    </ul>
  </section>
</template>
