/**
 * 静态资源 URL 解析
 *
 * db.json 里的图片路径写成站内绝对路径（如 `/images/xxx-cover.svg`），语义清晰。
 * 但 GitHub Pages 部署在子路径（如 /fnaf-games/）时，`/images/...` 会指向域名根目录而 404。
 * 因此所有图片必须经过本函数，用 Vite 注入的 BASE_URL 拼一次前缀。
 */
export function assetUrl(path: string): string {
  if (!path) return ''
  // 已经是完整外链 / 内联数据 / 本地临时对象地址就不处理
  if (
    /^(https?:)?\/\//.test(path) ||
    path.startsWith('data:') ||
    path.startsWith('blob:')
  ) {
    return path
  }
  const base = import.meta.env.BASE_URL
  return `${base}${path.replace(/^\/+/, '')}`
}
