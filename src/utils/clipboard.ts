/**
 * 剪贴板写入（带回退链路）
 *
 * `navigator.clipboard.writeText` 有两个硬性前提，缺一即抛错：
 *   1. 必须处于安全上下文（https / localhost）
 *   2. 如果页面被嵌在 iframe 里，外层必须授予 `clipboard-write` 权限
 * 预览面板 / 部分内嵌场景正是这种情况，所以必须准备回退方案。
 *
 * 回退方案用「临时 textarea + document.execCommand('copy')」，
 * 虽然 API 已标记废弃，但它是唯一能在受限 iframe 内工作的同步复制手段。
 *
 * @returns 是否复制成功。调用方**必须**据此给出可见反馈，不能静默失败。
 */
export async function copyText(text: string): Promise<boolean> {
  // —— 方案一：现代 Clipboard API ——
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function' &&
      (typeof window === 'undefined' || window.isSecureContext)
    ) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限被拒 / 非安全上下文，继续走回退方案
  }

  // —— 方案二：临时 textarea + execCommand ——
  try {
    if (typeof document === 'undefined') return false

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    // 移出视口但保留在文档流内，否则无法被选中
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)

    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)

    const succeeded = document.execCommand('copy')
    document.body.removeChild(textarea)
    return succeeded
  } catch {
    return false
  }
}
