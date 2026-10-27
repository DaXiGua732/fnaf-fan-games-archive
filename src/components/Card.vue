<script setup lang="ts">
/**
 * Card —— Swiss International Style 基础容器
 * 硬性规则：
 *  - 直角、无阴影、无渐变
 *  - 默认纸色底 + 墨色边框
 *  - interactive 时：悬停左边框变强调色并加粗至 4px，底色转 surface
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
    class="group block rounded-none border border-ink border-l-4 border-l-transparent bg-paper transition-colors duration-150 ease-out"
    :class="interactive ? 'cursor-pointer hover:border-l-accent hover:bg-surface' : ''"
  >
    <!-- 媒体区（封面 / Banner） -->
    <div v-if="$slots.media" class="border-b border-ink">
      <slot name="media" />
    </div>

    <!-- 主体内容 -->
    <div :class="padded ? 'px-6 py-6 md:px-8 md:py-8' : ''">
      <slot />
    </div>

    <!-- 底部元信息 -->
    <footer
      v-if="$slots.footer"
      class="border-t border-line px-6 py-4 md:px-8"
    >
      <slot name="footer" />
    </footer>
  </article>
</template>
