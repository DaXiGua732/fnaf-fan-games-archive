/** 运行时数据的最基础形状判断：非 null、非数组的对象 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
