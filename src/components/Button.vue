<script setup lang="ts">
import { computed } from 'vue'

/**
 * Button —— Swiss International Style 基础组件
 * 硬性规则：
 *  - 直角（rounded-none），无阴影，无渐变
 *  - 悬停只改变颜色，过渡上限 duration-150 ease-out
 *  - 唯一允许的位移：内部箭头 group-hover:translate-x-2
 */
type Variant = 'solid' | 'outline' | 'ghost'
type Size = 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    href?: string
    target?: string
    disabled?: boolean
    arrow?: boolean
    block?: boolean
  }>(),
  {
    variant: 'solid',
    size: 'md',
    href: undefined,
    target: undefined,
    disabled: false,
    arrow: true,
    block: false,
  },
)

const tag = computed(() => (props.href ? 'a' : 'button'))

const BASE =
  'group inline-flex items-center gap-4 rounded-none border font-sans font-bold uppercase ' +
  'tracking-[0.16em] transition-colors duration-150 ease-out select-none ' +
  'disabled:cursor-not-allowed disabled:opacity-40'

const VARIANTS: Record<Variant, string> = {
  // 黑色直角按钮：悬停整块变红
  solid: 'border-black bg-black text-white hover:border-[#ff0000] hover:bg-[#ff0000] hover:text-white',
  // 白底黑框：悬停反转
  outline: 'border-black bg-white text-black hover:bg-black hover:text-white',
  // 幽灵按钮：仅文字变红
  ghost: 'border-transparent bg-transparent text-black hover:text-[#ff0000]',
}

const SIZES: Record<Size, string> = {
  md: 'px-6 py-3 text-[11px]',
  lg: 'px-8 py-4 text-xs',
}

const classes = computed(() => [
  BASE,
  VARIANTS[props.variant],
  SIZES[props.size],
  props.block ? 'w-full justify-between' : 'justify-start',
])
</script>

<template>
  <component
    :is="tag"
    :href="href"
    :target="target"
    :rel="target === '_blank' ? 'noopener noreferrer' : undefined"
    :type="tag === 'button' ? 'button' : undefined"
    :disabled="tag === 'button' && disabled ? true : undefined"
    :class="classes"
  >
    <span><slot /></span>
    <span v-if="arrow" aria-hidden="true" class="u-arrow">&#8594;</span>
  </component>
</template>
