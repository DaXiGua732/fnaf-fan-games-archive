/**
 * 时间戳显示工具
 *
 * 【语义】空字符串 = 数据源尚未记录该字段 → 渲染为「—」，**不伪造日期**。
 *
 * 【时区】有值时按**查看者本地时区**渲染。存储用的是 UTC（`toISOString()` 带 Z 后缀），
 * 如果直接切字符串，等于把 UTC 当成当地时间显示 —— 在 GMT+8 下会差 8 小时。
 *
 * ⚠️ 因此渲染结果**依赖运行环境的时区**，冒烟断言不要断言时间戳字符串
 *    （Node 与浏览器时区可能不同），只断言列存在即可。
 *    判断标准：同一个字符串在不同机器上会不会不一样？会，就别写进断言。
 */

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-09-29 01:37`；空值 → `—`；无法解析时原样返回 */
export function formatTimestamp(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
