<script setup lang="ts">
import { RouterView } from 'vue-router'

/**
 * App —— 应用根组件
 *
 * 【Phase 1 变更】原先是 `<Layout><RouterView /></Layout>`，公开站骨架被写死在根组件上，
 * 导致后台路由无法脱离公开站 Header / Footer。现改为纯路由出口，
 * 由 routes.ts 的嵌套路由决定挂载 Layout（公开站）还是 AdminLayout（后台）。
 *
 * 公开站 URL 与渲染结果保持不变：`/#/` `/#/game/:id` `/#/debug` `/#/style` `/#/*` 仍走 Layout，
 * 渲染结果经逐字节核对确认视觉零变化（详见 admin_phase0_design_freeze.md §3.1）。
 */
</script>

<template>
  <RouterView />
</template>
