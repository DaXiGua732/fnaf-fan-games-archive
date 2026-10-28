/**
 * 页内跳转。
 *
 * ⚠️ Hash 路由下不能用 `href="#id"` —— 浏览器会改 hash，vue-router 会把它当成
 * 一次路由跳转（跳到另一个界面），而不是滚动。所有页内跳转都走这里。
 */
export function scrollToId(id: string): void {
  if (typeof document === 'undefined') return
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
}

export function scrollToTop(): void {
  if (typeof window === 'undefined') return
  window.scrollTo(0, 0)
}

/** 跳到主内容并把焦点交给它（屏幕阅读器 / 键盘用户的无障碍链接） */
export function focusAndScrollToId(id: string): void {
  if (typeof document === 'undefined') return
  const target = document.getElementById(id)
  if (!target) return
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start' })
}
