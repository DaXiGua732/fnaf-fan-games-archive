<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  GISCUS_CONFIG,
  GISCUS_SCRIPT_SRC,
  giscusThemeUrl,
  isGiscusConfigured,
} from '../config/giscus'

/**
 * CommentSection —— Giscus 评论区
 *
 * Giscus 会向页面注入一段 client.js，由它在容器内创建 iframe。
 * 未配置时**不注入任何脚本**，改为渲染一个说明占位块 —— 绝不因为缺配置而报错或留白。
 *
 * 样式说明：iframe 内部是 giscus.app 的跨域文档，父页面 CSS 注入不进去。
 * 全部视觉定制通过 data-theme 指向的 /giscus-swiss.css 在 iframe 内部生效。
 */
const props = defineProps<{
  /** 讨论串标识。Hash 路由下用 game.id，保证一游戏一讨论串 */
  term: string
}>()

const configured = isGiscusConfigured()
const host = ref<HTMLElement | null>(null)

function injectGiscus(): void {
  const container = host.value
  if (container === null) return

  // 清空容器，避免热更新或重复挂载时注入多份脚本
  container.innerHTML = ''

  const script = document.createElement('script')
  script.src = GISCUS_SCRIPT_SRC
  script.async = true
  script.crossOrigin = 'anonymous'

  const attributes: Record<string, string> = {
    'data-repo': GISCUS_CONFIG.repo,
    'data-repo-id': GISCUS_CONFIG.repoId,
    'data-category': GISCUS_CONFIG.category,
    'data-category-id': GISCUS_CONFIG.categoryId,
    'data-mapping': GISCUS_CONFIG.mapping,
    'data-term': props.term,
    'data-strict': '1',
    'data-reactions-enabled': GISCUS_CONFIG.reactionsEnabled ? '1' : '0',
    'data-emit-metadata': '0',
    'data-input-position': GISCUS_CONFIG.inputPosition,
    'data-theme': giscusThemeUrl(),
    'data-lang': GISCUS_CONFIG.lang,
    'data-loading': GISCUS_CONFIG.loading,
  }

  for (const [key, value] of Object.entries(attributes)) {
    script.setAttribute(key, value)
  }

  container.appendChild(script)
}

onMounted(() => {
  if (configured) injectGiscus()
})
</script>

<template>
  <section>
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-black pb-4">
      <h2 class="font-sans text-2xl font-bold uppercase tracking-tight">评论区</h2>
      <p class="swiss-meta text-black/60">
        {{ configured ? '由 Giscus 驱动 · GitHub Discussions' : '尚未启用' }}
      </p>
    </div>

    <!-- 已配置：Giscus 会把 iframe 注入此容器 -->
    <div v-if="configured" ref="host" class="giscus" />

    <!-- 未配置：说明占位，不报错不留白 -->
    <div v-else class="border border-black px-6 py-10 md:px-10 md:py-12">
      <p class="font-sans text-lg font-bold uppercase tracking-tight">
        评论功能待接入
      </p>
      <p class="mt-4 max-w-[68ch] font-sans text-sm leading-relaxed text-black/60">
        评论区基于 Giscus（GitHub Discussions）实现，需要你自己的公开仓库。完成下面几步后，
        把参数填入 <code class="font-sans font-bold">src/config/giscus.ts</code> 并把
        <code class="font-sans font-bold">enabled</code> 改为 <code class="font-sans font-bold">true</code> 即可上线。
      </p>

      <ol class="mt-8 space-y-4">
        <li
          v-for="(step, index) in [
            '新建一个公开仓库（建议与站点代码仓库分开），例如 fnaf-archive-comments',
            '该仓库 Settings → General → Features → 勾选 Discussions',
            '在 Discussions 中新建分类 Announcements（类型选 Announcements，仅维护者可发起）',
            '安装 giscus App 并授权该仓库：github.com/apps/giscus',
            '打开 giscus.app/zh-CN 填入仓库名，页面会生成 repoId 与 categoryId，抄进配置文件',
          ]"
          :key="step"
          class="grid grid-cols-[40px_minmax(0,1fr)] gap-4 border-t border-[#cccccc] pt-4"
        >
          <span class="swiss-meta font-bold text-[#ff0000]">
            {{ String(index + 1).padStart(2, '0') }}
          </span>
          <span class="font-sans text-sm leading-relaxed">{{ step }}</span>
        </li>
      </ol>

      <p class="mt-8 border-t border-[#cccccc] pt-6 font-sans text-xs leading-relaxed text-black/50">
        注意：本站使用 Hash 路由，配置里的 mapping 已固定为
        <code class="font-sans font-bold">specific</code>。若改成
        <code class="font-sans font-bold">pathname</code>，所有游戏的评论会被合并到同一个讨论串。
      </p>
    </div>
  </section>
</template>
