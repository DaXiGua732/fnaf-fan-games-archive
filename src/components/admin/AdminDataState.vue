<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useAdminGames } from '../../composables/useAdminGames'

/**
 * 数据源状态：加载中 / 出错。
 *
 * 【为什么必须单独存在】登录之后数据源换成远程数据仓，`db.json` 要先把拉下来。
 * 那短短几百毫秒里，如果直接把「空列表」渲染出去，用户看到的是
 * **「我的数据全没了」** —— 比一个明确的「加载中」吓人得多。
 * 出错时同理：必须说清原因，并给一个**能点**的动作，而不是留一张空表。
 *
 * 就绪且无错时它什么都不渲染（两个分支都不成立），所以调用方可以无脑放在页面顶部。
 */
const { ready, loadError, reload } = useAdminGames()
</script>

<template>
  <div
    v-if="!ready"
    class="mt-8 border border-[#cccccc] border-l-4 border-l-black px-6 py-5"
    role="status"
    aria-live="polite"
  >
    <p class="swiss-meta text-black/60">数据加载中</p>
    <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
      正在从数据仓读取最新数据……
    </p>
  </div>

  <div
    v-else-if="loadError"
    class="mt-8 border border-[#ff0000] px-6 py-5"
    role="alert"
    aria-live="assertive"
  >
    <p class="swiss-meta font-bold text-[#ff0000]">数据加载失败</p>
    <p class="mt-2 max-w-[78ch] font-sans text-sm leading-relaxed text-black">{{ loadError }}</p>

    <div class="mt-4 flex flex-wrap items-center gap-4">
      <button
        type="button"
        class="rounded-none border border-black bg-white px-4 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 ease-out hover:bg-black hover:text-white"
        @click="reload"
      >
        重试
      </button>
      <RouterLink
        :to="{ name: 'admin-login' }"
        class="font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]"
      >
        重新登录
      </RouterLink>
    </div>
  </div>
</template>
