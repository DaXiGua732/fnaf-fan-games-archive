<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'

/**
 * 后台 404 兜底
 *
 * 存在的意义：保证输错的后台地址仍然渲染在**后台骨架内**，
 * 而不是掉回公开站的 `/` 兜底页（那会造成两套外壳串台）。
 */
const route = useRoute()
</script>

<template>
  <div class="py-12 md:py-16">
    <p class="swiss-meta mb-6 text-black/60">Error 404 — Admin Route Not Found</p>

    <h1 class="font-sans text-2xl font-bold uppercase leading-[0.95] tracking-tight md:text-4xl">
      后台没有这个页面
    </h1>

    <p class="mt-8 max-w-[60ch] font-sans text-sm leading-relaxed text-black/60">
      该后台路径不存在，可能是链接失效或地址打错。请从左侧分区导航进入对应模块。
    </p>

    <p class="swiss-meta mb-4 mt-12 text-black/45">请求的路径</p>
    <p class="mb-12 font-sans text-sm font-bold break-all">{{ route.fullPath }}</p>

    <RouterLink
      to="/admin/games"
      class="group inline-flex items-center gap-4 border border-black bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 ease-out hover:border-[#ff0000] hover:bg-[#ff0000]"
    >
      <span>前往游戏管理</span>
      <span class="u-arrow" aria-hidden="true">&#8594;</span>
    </RouterLink>
  </div>
</template>
