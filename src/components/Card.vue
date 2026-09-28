<script setup lang="ts">
/**
 * Card —— Swiss International Style 基础容器
 * 硬性规则：
 *  - 直角、无阴影、无渐变
 *  - 默认白底 + 黑边框
 *  - interactive 时：悬停左边框变红并加粗至 4px，底色转 #f9f9f9
 *    （左侧预留 4px 透明边框，避免加粗时产生布局抖动）
 */
withDefaults(
  defineProps<{
    interactive?: boolean
    padded?: boolean
  }>(),
  {
    interactive: false,
    padded: true,
  },
)
</script>

<template>
  <article
    class="group block rounded-none border border-black border-l-4 border-l-transparent bg-white transition-colors duration-150 ease-out"
    :class="interactive ? 'cursor-pointer hover:border-l-[#ff0000] hover:bg-[#f9f9f9]' : ''"
  >
    <!-- 媒体区（封面 / Banner） -->
    <div v-if="$slots.media" class="border-b border-black">
      <slot name="media" />
    </div>

    <!-- 主体内容 -->
    <div :class="padded ? 'px-6 py-6 md:px-8 md:py-8' : ''">
      <slot />
    </div>

    <!-- 底部元信息 -->
    <footer
      v-if="$slots.footer"
      class="border-t border-[#cccccc] px-6 py-4 md:px-8"
    >
      <slot name="footer" />
    </footer>
  </article>
</template>
