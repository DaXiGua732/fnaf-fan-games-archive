/**
 * 初始分类词表
 *
 * 只建词条，**不给任何作品打分类**。词条定义可以随时在后台修改；
 * 这里的两条玩法与五条机制来自任务书明确给出的例子，不是完整的行业标准。
 *
 * 为什么要有内置初始值：
 *   - 旧数据仓 / 旧快照里没有 `taxonomy` 字段时，前台仍能拿到一套可用的词表；
 *   - 管理员第一次打开词表页时有一个可读的起点，而不是一片空白。
 *
 * 一旦数据仓里存在 `taxonomy`（哪怕是空数组），就以数据仓为准 ——
 * 管理员删空的词表不会在下次启动时被这里「复活」。
 */
import type { Taxonomy, VocabularyEntry } from '../types/taxonomy'

function entry(id: string, name: string, description = ''): VocabularyEntry {
  return { id, name, description }
}

const INITIAL_TAXONOMY: Taxonomy = {
  gameplayTypes: [
    entry(
      'traditional-night-watch',
      '传统守夜式',
      '以固定地点、按夜推进、在有限资源下抵御威胁为核心循环。',
    ),
    entry(
      'exploration',
      '漫步探索式',
      '以自由移动、探索场景与推进叙事为核心循环。',
    ),
  ],
  mechanics: [
    entry('security-cameras', '监控摄像头'),
    entry('resource-management', '资源管理'),
    entry('stealth', '潜行'),
    entry('puzzle', '解谜'),
    entry('free-roaming', '自由移动'),
  ],
  platforms: [
    entry('windows', 'Windows'),
    entry('macos', 'macOS'),
    entry('linux', 'Linux'),
    entry('android', 'Android'),
    entry('ios', 'iOS'),
    entry('web', 'Web'),
  ],
}

/**
 * 返回一份**深拷贝**。
 *
 * 不能直接导出对象：调用方（仓储、测试）会修改词表，
 * 共享同一个对象会让一次编辑影响另一个仓储实例或下一轮测试。
 */
export function initialTaxonomy(): Taxonomy {
  return {
    gameplayTypes: INITIAL_TAXONOMY.gameplayTypes.map((item) => ({ ...item })),
    mechanics: INITIAL_TAXONOMY.mechanics.map((item) => ({ ...item })),
    platforms: INITIAL_TAXONOMY.platforms.map((item) => ({ ...item })),
  }
}
