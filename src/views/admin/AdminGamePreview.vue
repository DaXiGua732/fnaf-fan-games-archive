<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { PREVIEW_GAME_KEY, readPreview } from '../../composables/useGamePreview'
import GameDetail from '../GameDetail.vue'

/**
 * /admin/preview —— 预览编辑中的内容
 *
 * 【这里渲染的是真组件】用的是 `views/GameDetail.vue` **本身**，
 * 通过 `PREVIEW_GAME_KEY` 把「未保存的草稿」注入进去。
 * 不另写一个"像前台"的预览页 —— 那种副本迟早会跟真实前台分叉，
 * 而分叉之后预览就在骗人。
 *
 * 【为什么草稿来自 sessionStorage】编辑页点「预览」时会开一个新标签页，
 * 这样编辑页不会被卸载（未保存的改动不会丢）。跨标签页传递只能靠 storage。
 *
 * ⚠️ 本路由挂在 `/admin` 下，因此**自动受登录门禁保护** ——
 *    它显示的是未发布内容，绝不能被公开地址渲染。
 */
const game = ref(readPreview())

// 注入给真实的 GameDetail —— 它只在拿到这个时才走预览分支
provide(PREVIEW_GAME_KEY, game)

/** 预览「名义上的 id」：新作品还没有 id，给个占位以免路由取不到 */
const detailId = computed(() => game.value?.id || 'preview')

const backTo = computed(() =>
  game.value?.id && game.value.id !== 'preview'
    ? { name: 'admin-game-edit', params: { id: game.value.id } }
    : { name: 'admin-game-new' },
)
</script>

<template>
  <div class="py-12 md:py-16">
    <!-- ============ 预览说明条 ============ -->
    <div class="border border-[#ff0000] px-6 py-5" role="status">
      <p class="swiss-meta font-bold text-[#ff0000]">预览 · 未保存</p>
      <p class="mt-2 max-w-[78ch] font-sans text-sm leading-relaxed text-black/70">
        下面就是<span class="font-bold text-black">前台详情页的真实渲染结果</span>，
        用的是编辑页里<span class="font-bold text-black">当前（可能还没保存）</span>的内容。
        <span class="font-bold text-black">它不会对外可见，也不会写进数据仓</span> ——
        想真正生效，回编辑页点「保存」。
      </p>
      <div class="mt-4 flex flex-wrap items-center gap-6">
        <RouterLink
          :to="backTo"
          class="group inline-flex items-baseline gap-3 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-black transition-colors duration-150 ease-out hover:text-[#ff0000]"
        >
          <span class="u-arrow-back" aria-hidden="true">&#8594;</span>
          <span>回到编辑页</span>
        </RouterLink>
        <RouterLink
          :to="{ name: 'admin-games' }"
          class="font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-black/60 transition-colors duration-150 ease-out hover:text-[#ff0000]"
        >
          游戏管理
        </RouterLink>
      </div>
    </div>

    <!-- ============ 没有可预览的内容 ============ -->
    <div v-if="!game" class="mt-8 border border-[#cccccc] px-6 py-5">
      <p class="swiss-meta text-black/60">没有可预览的内容</p>
      <p class="mt-2 max-w-[78ch] font-sans text-xs leading-relaxed text-black/70">
        预览内容只存在这一次浏览里（刷新或直接打开这个地址都会丢）——
        请回到编辑页点「预览」重新打开。
      </p>
    </div>

    <!-- ============ 真实的前台详情页 ============ -->
    <div v-else class="mt-8">
      <GameDetail :id="detailId" />
    </div>
  </div>
</template>
