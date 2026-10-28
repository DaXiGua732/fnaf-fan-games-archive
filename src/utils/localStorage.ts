/**
 * 本机存储的唯一访问入口。
 *
 * 三种环境必须都返回 null 而不是抛错：
 *   - SSR / Node（没有 localStorage）
 *   - 隐私模式（某些浏览器连**读取这个属性**都会抛）
 *   - 测试（由调用方注入假 Storage，不走这里）
 *
 * 每次调用都重新读 `globalThis`：测试会在创建实例之前替换它，
 * 模块加载时缓存一份会让替换失效。
 */
export function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}
