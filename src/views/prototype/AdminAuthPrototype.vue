<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * PROTOTYPE — admin access / invite / role surfaces.
 *
 * Question: can a non-technical admin complete Google sign-in, accept an email
 * allowlist invite, understand their role, and see what they cannot do?
 *
 * Three structurally different variants, switchable with `?variant=A|B|C`.
 * Read-only: no real auth, no persistence, no mutations. Capture the verdict,
 * then move this file to a throwaway branch; do not merge it.
 */

type Scenario = 'signed-out' | 'invited' | 'editor' | 'owner' | 'revoked'

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'signed-out', label: '未登录' },
  { id: 'invited', label: '已邀请' },
  { id: 'editor', label: 'Editor' },
  { id: 'owner', label: 'Owner' },
  { id: 'revoked', label: '会话已撤销' },
]

const VARIANTS = [
  { id: 'A', label: 'Split editorial' },
  { id: 'B', label: 'Step rail' },
  { id: 'C', label: 'Console table' },
] as const

const PERMISSIONS = [
  { label: '创建 / 编辑作品', owner: true, editor: true },
  { label: '发布 / 下线 / 归档', owner: true, editor: true },
  { label: '上传图片', owner: true, editor: true },
  { label: '标签 / 作者改名合并', owner: true, editor: true },
  { label: '删除标签 / 作者', owner: true, editor: false },
  { label: '词表合并 / 删除', owner: true, editor: false },
  { label: '邀请 / 移除管理员', owner: true, editor: false },
  { label: '永久删除 / 恢复', owner: true, editor: false },
  { label: '查看审计', owner: true, editor: false },
]

const PENDING_INVITES = [
  { email: 'new-editor@example.com', role: 'Editor', sent: '今天 09:12' },
  { email: 'second-owner@example.com', role: 'Owner', sent: '昨天 18:40' },
]

const scenario = ref<Scenario>('signed-out')
const route = useRoute()
const router = useRouter()
const isDev = import.meta.env.DEV

const variant = computed(() => {
  const value = String(route.query.variant ?? 'A').toUpperCase()
  return VARIANTS.some((item) => item.id === value) ? value : 'A'
})

const signedIn = computed(() => scenario.value === 'editor' || scenario.value === 'owner')
const currentRole = computed(() => (scenario.value === 'owner' ? 'Owner' : 'Editor'))
const currentEmail = computed(() =>
  scenario.value === 'owner' ? 'owner@example.com' : 'editor@example.com',
)
const variantLabel = computed(
  () => VARIANTS.find((item) => item.id === variant.value)?.label ?? '',
)

function setVariant(next: string): void {
  void router.replace({ query: { ...route.query, variant: next } })
}

function cycleVariant(delta: number): void {
  const index = VARIANTS.findIndex((item) => item.id === variant.value)
  const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
  setVariant(next.id)
}

function signIn(): void {
  scenario.value = 'invited'
}

function acceptInvite(): void {
  scenario.value = 'editor'
}

function signOut(): void {
  scenario.value = 'signed-out'
}

function revoke(): void {
  scenario.value = 'revoked'
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  if (target?.isContentEditable) return
  event.preventDefault()
  cycleVariant(event.key === 'ArrowRight' ? 1 : -1)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="min-h-screen bg-white pb-24 text-black">
    <!-- prototype controls (not part of the evaluated design) -->
    <div class="sticky top-0 z-50 border-b border-black bg-surface px-4 py-3 md:px-8">
      <div class="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3">
        <div>
          <p class="swiss-meta text-black/50">PROTOTYPE · ADMIN ACCESS</p>
          <p class="mt-1 font-sans text-xs text-black/60">
            只读原型；切换状态不会真的登录或发邀请。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="item in SCENARIOS"
            :key="item.id"
            type="button"
            class="border px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.12em] transition-colors duration-150"
            :class="
              scenario === item.id
                ? 'border-black bg-black text-white'
                : 'border-line bg-white text-black/60 hover:border-black hover:text-black'
            "
            :aria-pressed="scenario === item.id"
            @click="scenario = item.id"
          >
            {{ item.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- ============================ VARIANT A ============================ -->
    <div v-if="variant === 'A'" class="mx-auto max-w-[1280px]">
      <section class="grid border-b border-black lg:grid-cols-[1.15fr_.85fr]">
        <div class="bg-surface px-6 py-12 md:px-10 md:py-16">
          <p class="swiss-meta text-black/50">01 — ACCESS</p>
          <h1 class="mt-6 max-w-[12ch] font-sans text-4xl font-bold uppercase leading-[0.95] tracking-tight md:text-6xl">
            Invite only.
          </h1>
          <p class="mt-8 max-w-[54ch] font-sans text-sm leading-relaxed text-black/60">
            管理员不再共用 GitHub 令牌。用 Google 登录，按邮箱匹配邀请；角色由服务端强制，
            UI 隐藏按钮不算权限。
          </p>
          <dl class="mt-10 grid max-w-[52ch] gap-4 border-t border-black pt-6 text-xs">
            <div class="flex items-baseline justify-between gap-6">
              <dt class="swiss-meta text-black/50">身份</dt>
              <dd class="font-sans font-bold">Google OAuth</dd>
            </div>
            <div class="flex items-baseline justify-between gap-6">
              <dt class="swiss-meta text-black/50">角色</dt>
              <dd class="font-sans font-bold">Owner / Editor</dd>
            </div>
            <div class="flex items-baseline justify-between gap-6">
              <dt class="swiss-meta text-black/50">MFA</dt>
              <dd class="font-sans font-bold">Owner 强制 TOTP</dd>
            </div>
            <div class="flex items-baseline justify-between gap-6">
              <dt class="swiss-meta text-black/50">邀请</dt>
              <dd class="font-sans font-bold">邮箱允许列表</dd>
            </div>
          </dl>
        </div>

        <div class="px-6 py-12 md:px-10 md:py-16">
          <p class="swiss-meta text-black/50">CURRENT SESSION</p>

          <div v-if="scenario === 'signed-out'" class="mt-6">
            <h2 class="font-sans text-2xl font-bold uppercase tracking-tight">管理员登录</h2>
            <p class="mt-4 max-w-[46ch] font-sans text-sm leading-relaxed text-black/60">
              使用你的 Google 账号继续。只有被 Owner 加入允许列表的邮箱才能进入后台。
            </p>
            <button
              type="button"
              class="mt-8 inline-flex w-full items-center justify-center gap-3 border border-black bg-white px-6 py-4 font-sans text-[11px] font-bold uppercase tracking-[0.16em] transition-colors duration-150 hover:bg-black hover:text-white"
              @click="signIn"
            >
              使用 Google 继续
              <span class="u-arrow" aria-hidden="true">&#8594;</span>
            </button>
            <p class="mt-4 font-sans text-xs leading-relaxed text-black/45">
              登录后会检查邀请；未受邀账号可以完成 Google 认证，但不会获得任何后台权限。
            </p>
          </div>

          <div v-else-if="scenario === 'invited'" class="mt-6 border border-black px-5 py-6">
            <p class="swiss-meta text-accent">INVITE FOUND</p>
            <h2 class="mt-3 font-sans text-xl font-bold uppercase tracking-tight">
              editor@example.com
            </h2>
            <p class="mt-3 font-sans text-sm leading-relaxed text-black/60">
              邀请角色：<strong class="font-bold text-black">Editor</strong>。接受后可以创建、编辑、发布与归档作品。
            </p>
            <button
              type="button"
              class="mt-6 inline-flex items-center justify-center border border-black bg-black px-5 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-white transition-colors duration-150 hover:bg-accent-surface hover:text-on-accent"
              @click="acceptInvite"
            >
              接受邀请
            </button>
            <button
              type="button"
              class="ml-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-black/50 underline underline-offset-4 hover:text-black"
              @click="signOut"
            >
              换一个账号
            </button>
          </div>

          <div v-else-if="signedIn" class="mt-6">
            <div class="flex items-start justify-between gap-4 border-b border-black pb-5">
              <div>
                <p class="font-sans text-lg font-bold">{{ currentEmail }}</p>
                <p class="mt-1 font-sans text-xs text-black/50">Google · TOTP 已绑定</p>
              </div>
              <span class="border border-black px-2 py-1 font-sans text-[10px] font-bold uppercase tracking-[0.14em]">
                {{ currentRole }}
              </span>
            </div>
            <div class="mt-5 grid gap-3 font-sans text-xs text-black/60">
              <p>会话：活跃 · 最近刷新刚刚</p>
              <p>
                你可以
                <strong class="text-black">创建、编辑、发布、归档</strong>
                作品，维护标签与词表。
              </p>
              <p v-if="scenario === 'editor'" class="border-l-2 border-line pl-3 text-black/45">
                Owner 专属：邀请管理员、永久删除 / 恢复、删除标签 / 作者、合并 / 删除词条、查看审计。
              </p>
            </div>
            <button
              type="button"
              class="mt-7 border border-black px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] transition-colors duration-150 hover:bg-black hover:text-white"
              @click="revoke"
            >
              撤销本会话（Owner 操作）
            </button>
          </div>

          <div v-else-if="scenario === 'revoked'" class="mt-6 border border-accent px-5 py-6">
            <p class="swiss-meta text-accent">SESSION REVOKED</p>
            <h2 class="mt-3 font-sans text-xl font-bold uppercase tracking-tight">
              这个会话已经失效
            </h2>
            <p class="mt-3 font-sans text-sm leading-relaxed text-black/60">
              你的管理员角色或会话已被撤销。下一次写入会被服务端拒绝；重新登录不会恢复权限。
            </p>
            <button
              type="button"
              class="mt-6 border border-black px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] hover:bg-black hover:text-white"
              @click="signOut"
            >
              回到登录
            </button>
          </div>
        </div>
      </section>

      <section v-if="scenario === 'owner'" class="grid border-b border-black md:grid-cols-[.8fr_1.2fr]">
        <div class="border-b border-black px-6 py-10 md:border-b-0 md:border-r md:px-10">
          <p class="swiss-meta text-black/50">OWNER ACTION</p>
          <h2 class="mt-4 font-sans text-xl font-bold uppercase tracking-tight">邀请管理员</h2>
          <p class="mt-3 max-w-[40ch] font-sans text-xs leading-relaxed text-black/60">
            输入邮箱与角色；系统把邮箱加入允许列表，你把登录方式线下告诉对方。
          </p>
          <div class="mt-6 grid gap-3">
            <input class="w-full border border-black bg-white px-4 py-3 font-sans text-sm" placeholder="name@example.com" />
            <select class="w-full border border-black bg-white px-4 py-3 font-sans text-sm">
              <option>Editor</option>
              <option>Owner</option>
            </select>
            <button type="button" class="border border-black bg-black px-4 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-white">
              加入允许列表
            </button>
          </div>
        </div>
        <div class="px-6 py-10 md:px-10">
          <p class="swiss-meta text-black/50">PENDING INVITES</p>
          <table class="mt-4 w-full border-collapse text-left font-sans text-xs">
            <thead>
              <tr class="border-b border-black">
                <th class="py-2 font-bold uppercase tracking-[0.12em]">邮箱</th>
                <th class="py-2 font-bold uppercase tracking-[0.12em]">角色</th>
                <th class="py-2 font-bold uppercase tracking-[0.12em]">发出</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="invite in PENDING_INVITES" :key="invite.email" class="border-b border-line">
                <td class="py-3">{{ invite.email }}</td>
                <td class="py-3">{{ invite.role }}</td>
                <td class="py-3 text-black/50">{{ invite.sent }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- ============================ VARIANT B ============================ -->
    <div v-else-if="variant === 'B'" class="mx-auto max-w-[1280px]">
      <section class="grid border-b border-black md:grid-cols-[260px_1fr]">
        <aside class="border-b border-black bg-surface px-6 py-10 md:border-b-0 md:border-r">
          <p class="swiss-meta text-black/50">FLOW</p>
          <ol class="mt-6 space-y-5 font-sans text-xs">
            <li class="flex gap-4" :class="scenario === 'signed-out' || scenario === 'revoked' ? 'text-black' : 'text-black/40'">
              <span class="font-bold">01</span>
              <span>Google 登录</span>
            </li>
            <li class="flex gap-4" :class="scenario === 'invited' ? 'text-black' : 'text-black/40'">
              <span class="font-bold">02</span>
              <span>匹配邀请</span>
            </li>
            <li class="flex gap-4" :class="signedIn ? 'text-black' : 'text-black/40'">
              <span class="font-bold">03</span>
              <span>进入后台</span>
            </li>
          </ol>
          <div class="mt-10 border-t border-line pt-5 font-sans text-xs leading-relaxed text-black/55">
            <p>角色：{{ signedIn ? currentRole : '—' }}</p>
            <p class="mt-2">MFA：{{ scenario === 'owner' ? 'TOTP 已绑定' : 'Editor 可选' }}</p>
            <p class="mt-2">会话：{{ signedIn ? '活跃' : scenario === 'revoked' ? '已撤销' : '无' }}</p>
          </div>
        </aside>

        <div class="px-6 py-12 md:px-12 md:py-16">
          <p class="swiss-meta text-black/50">ADMIN ACCESS / STEP {{ signedIn ? '03' : scenario === 'invited' ? '02' : '01' }}</p>

          <div v-if="scenario === 'signed-out' || scenario === 'revoked'" class="mt-6 max-w-[60ch]">
            <h1 class="font-sans text-3xl font-bold uppercase leading-[0.95] tracking-tight md:text-5xl">
              {{ scenario === 'revoked' ? 'Session revoked.' : 'Sign in with Google.' }}
            </h1>
            <p class="mt-6 font-sans text-sm leading-relaxed text-black/60">
              不需要密码，也不要求 GitHub。系统只允许 Owner 加入允许列表的邮箱进入。
            </p>
            <button
              type="button"
              class="mt-8 inline-flex items-center gap-3 border border-black bg-black px-6 py-4 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-white transition-colors duration-150 hover:bg-accent-surface hover:text-on-accent"
              @click="signIn"
            >
              使用 Google 继续
              <span aria-hidden="true">&#8594;</span>
            </button>
            <p v-if="scenario === 'revoked'" class="mt-6 border-l-2 border-accent pl-4 font-sans text-xs leading-relaxed text-black/60">
              这个会话已被撤销。重新登录不会恢复角色，除非 Owner 重新邀请。
            </p>
          </div>

          <div v-else-if="scenario === 'invited'" class="mt-6 max-w-[60ch]">
            <h1 class="font-sans text-3xl font-bold uppercase leading-[0.95] tracking-tight md:text-5xl">
              Invite found.
            </h1>
            <p class="mt-6 font-sans text-sm leading-relaxed text-black/60">
              <strong class="text-black">editor@example.com</strong> 的邀请已匹配。角色：
              <strong class="text-black">Editor</strong>。
            </p>
            <button
              type="button"
              class="mt-8 border border-black bg-black px-6 py-4 font-sans text-[11px] font-bold uppercase tracking-[0.16em] text-white"
              @click="acceptInvite"
            >
              接受邀请并进入后台
            </button>
          </div>

          <div v-else class="mt-6">
            <div class="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-6">
              <div>
                <h1 class="font-sans text-3xl font-bold uppercase leading-[0.95] tracking-tight md:text-5xl">
                  {{ currentRole }} access.
                </h1>
                <p class="mt-3 font-sans text-sm text-black/55">{{ currentEmail }}</p>
              </div>
              <button
                type="button"
                class="border border-black px-4 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.14em] hover:bg-black hover:text-white"
                @click="signOut"
              >
                退出
              </button>
            </div>

            <div class="mt-8 grid gap-6 sm:grid-cols-2">
              <div class="border border-line px-5 py-5">
                <p class="swiss-meta text-black/45">可以</p>
                <p class="mt-3 font-sans text-sm leading-relaxed">创建、编辑、发布、归档作品；维护标签与词表。</p>
              </div>
              <div class="border border-line px-5 py-5">
                <p class="swiss-meta text-black/45">不可以</p>
                <p class="mt-3 font-sans text-sm leading-relaxed">
                  {{ scenario === 'editor' ? '邀请管理员、永久删除、删除标签 / 作者、合并词条、查看审计。' : '无（Owner）' }}
                </p>
              </div>
            </div>

            <div v-if="scenario === 'owner'" class="mt-10 border-t border-black pt-8">
              <p class="swiss-meta text-black/50">OWNER · INVITE</p>
              <div class="mt-4 grid gap-3 md:grid-cols-[1fr_180px_auto]">
                <input class="border border-black bg-white px-4 py-3 font-sans text-sm" placeholder="name@example.com" />
                <select class="border border-black bg-white px-4 py-3 font-sans text-sm">
                  <option>Editor</option>
                  <option>Owner</option>
                </select>
                <button type="button" class="border border-black bg-black px-5 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-white">
                  邀请
                </button>
              </div>
              <p class="mt-3 font-sans text-xs text-black/45">Pending: {{ PENDING_INVITES.length }} 个邮箱等待首次登录。</p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ============================ VARIANT C ============================ -->
    <div v-else class="mx-auto max-w-[1280px]">
      <section class="border-b border-black">
        <div class="flex flex-wrap items-center justify-between gap-4 bg-inverse px-6 py-4 text-inverse-fg md:px-10">
          <div class="flex flex-wrap items-center gap-x-8 gap-y-2 font-sans text-[11px] uppercase tracking-[0.14em]">
            <span class="font-bold">SESSION</span>
            <span>{{ signedIn ? 'ACTIVE' : scenario === 'revoked' ? 'REVOKED' : 'NONE' }}</span>
            <span>{{ signedIn ? currentEmail : '—' }}</span>
            <span>{{ signedIn ? currentRole : '—' }}</span>
            <span class="text-inverse-fg/50">MFA {{ scenario === 'owner' ? 'ON' : '—' }}</span>
          </div>
          <button
            v-if="signedIn"
            type="button"
            class="border border-inverse-fg/40 px-3 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] hover:border-inverse-fg"
            @click="revoke"
          >
            撤销会话
          </button>
        </div>

        <div class="grid lg:grid-cols-[1.15fr_.85fr]">
          <div class="border-b border-black px-6 py-10 lg:border-b-0 lg:border-r md:px-10">
            <div v-if="scenario === 'signed-out' || scenario === 'revoked'" class="max-w-[58ch]">
              <p class="swiss-meta text-black/50">AUTH STRIP</p>
              <h1 class="mt-4 font-sans text-2xl font-bold uppercase tracking-tight">
                {{ scenario === 'revoked' ? '会话已撤销' : '等待登录' }}
              </h1>
              <p class="mt-3 font-sans text-sm leading-relaxed text-black/60">
                Google OAuth · 邮箱允许列表 · Owner 强制 TOTP。未受邀邮箱可以认证，但拿不到后台数据。
              </p>
              <button
                type="button"
                class="mt-6 border border-black bg-black px-5 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-white"
                @click="signIn"
              >
                使用 Google 继续
              </button>
            </div>

            <div v-else-if="scenario === 'invited'">
              <p class="swiss-meta text-black/50">INVITE QUEUE</p>
              <h1 class="mt-4 font-sans text-2xl font-bold uppercase tracking-tight">待接受邀请</h1>
              <p class="mt-3 font-sans text-sm text-black/60">editor@example.com · Editor</p>
              <button
                type="button"
                class="mt-6 border border-black bg-black px-5 py-3 font-sans text-[11px] font-bold uppercase tracking-[0.14em] text-white"
                @click="acceptInvite"
              >
                接受
              </button>
            </div>

            <div v-else>
              <div class="flex items-end justify-between gap-4">
                <div>
                  <p class="swiss-meta text-black/50">ADMIN CONSOLE</p>
                  <h1 class="mt-3 font-sans text-2xl font-bold uppercase tracking-tight">
                    {{ currentRole }} · {{ currentEmail }}
                  </h1>
                </div>
                <button type="button" class="font-sans text-[11px] font-bold uppercase tracking-[0.14em] underline underline-offset-4" @click="signOut">
                  退出
                </button>
              </div>

              <div class="mt-8 border border-line">
                <div class="flex items-center justify-between border-b border-line px-4 py-3">
                  <p class="swiss-meta text-black/50">PENDING INVITES</p>
                  <p class="font-sans text-[10px] text-black/40">只读示例</p>
                </div>
                <table class="w-full border-collapse text-left font-sans text-xs">
                  <tbody>
                    <tr v-for="invite in PENDING_INVITES" :key="invite.email" class="border-b border-line last:border-b-0">
                      <td class="px-4 py-3">{{ invite.email }}</td>
                      <td class="px-4 py-3">{{ invite.role }}</td>
                      <td class="px-4 py-3 text-black/40">{{ invite.sent }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="scenario === 'owner'" class="mt-6 grid gap-3 border border-black p-4 md:grid-cols-[1fr_150px_auto]">
                <input class="border border-line bg-white px-3 py-2 font-sans text-sm" placeholder="name@example.com" />
                <select class="border border-line bg-white px-3 py-2 font-sans text-sm">
                  <option>Editor</option>
                  <option>Owner</option>
                </select>
                <button type="button" class="border border-black bg-black px-4 py-2 font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                  邀请
                </button>
              </div>
              <p v-else class="mt-6 border-l-2 border-line pl-4 font-sans text-xs leading-relaxed text-black/45">
                Editor 看不到邀请表单；Owner 专属操作由 RPC 拒绝，不只是隐藏。
              </p>
            </div>
          </div>

          <div class="px-6 py-10 md:px-10">
            <p class="swiss-meta text-black/50">PERMISSION MATRIX</p>
            <table class="mt-4 w-full border-collapse text-left font-sans text-xs">
              <thead>
                <tr class="border-b border-black">
                  <th class="py-2 font-bold uppercase tracking-[0.12em]">动作</th>
                  <th class="py-2 text-right font-bold uppercase tracking-[0.12em]">Owner</th>
                  <th class="py-2 text-right font-bold uppercase tracking-[0.12em]">Editor</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in PERMISSIONS" :key="row.label" class="border-b border-line">
                  <td class="py-2">{{ row.label }}</td>
                  <td class="py-2 text-right">{{ row.owner ? '✓' : '—' }}</td>
                  <td class="py-2 text-right" :class="row.editor ? '' : 'text-black/30'">{{ row.editor ? '✓' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>

    <!-- variant switcher (not part of the evaluated design) -->
    <div v-if="isDev" class="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-stretch border border-black bg-inverse text-inverse-fg">
      <button type="button" class="px-4 py-2 font-sans text-lg leading-none hover:bg-inverse-fg hover:text-inverse" aria-label="上一个变体" @click="cycleVariant(-1)">
        &#8592;
      </button>
      <div class="border-x border-inverse-fg/30 px-4 py-2 text-center font-sans text-[10px] uppercase tracking-[0.14em]">
        <span class="font-bold">{{ variant }}</span>
        <span class="mx-2 text-inverse-fg/40">/</span>
        <span>{{ variantLabel }}</span>
      </div>
      <button type="button" class="px-4 py-2 font-sans text-lg leading-none hover:bg-inverse-fg hover:text-inverse" aria-label="下一个变体" @click="cycleVariant(1)">
        &#8594;
      </button>
    </div>
  </div>
</template>
