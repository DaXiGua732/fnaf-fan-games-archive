/**
 * 资料质量检查断言（Phase 6）
 *
 * 工具是只读的：这里只验证「给定一份脏数据，能报告出正确的问题代码」，
 * 不验证任何写回行为（它没有写回）。
 */
import { analyzeCatalog } from '../utils/dataQuality'
import type { Assertion } from './libraryAssertions'

function codes(report: ReturnType<typeof analyzeCatalog>): string {
  return report.issues.map((issue) => issue.code).join(',')
}

/** 一条完全干净的记录，用来验证「没有误报」 */
function cleanGame() {
  return {
    id: 'clean',
    title: 'Clean Game',
    author: 'Clean Author',
    releaseYear: 2020,
    ipSeries: 'Clean Series',
    engine: 'Godot',
    coverImage: '/images/clean.png',
    bannerImage: '/images/clean-banner.png',
    gallery: [],
    description: 'Clean fixture.',
    downloads: [{ provider: 'Drive', url: 'https://example.com/clean' }],
    metrics: { fakeViews: 0, score: 0 },
    status: 'published',
    platforms: ['windows'],
    gameplayTypes: ['traditional-night-watch'],
    mechanics: ['security-cameras'],
    tags: [],
    altTitles: [],
    relations: [],
  }
}

function cleanTaxonomy() {
  return {
    gameplayTypes: [{ id: 'traditional-night-watch', name: '传统守夜式', description: '' }],
    mechanics: [{ id: 'security-cameras', name: '监控摄像头', description: '' }],
    platforms: [{ id: 'windows', name: 'Windows', description: '' }],
  }
}

export function runDataQualityAssertions(): Assertion[] {
  const results: Assertion[] = []
  const check = (name: string, actual: unknown, expected: unknown): void => {
    const a = String(actual)
    const e = String(expected)
    results.push({ name, expected: e, actual: a, pass: a === e })
  }

  /* ------------------------------------------------------------------ 干净数据 */
  const clean = analyzeCatalog(
    { games: [cleanGame()], taxonomy: cleanTaxonomy() },
    'clean.json',
  )
  check('干净数据 · ok', clean.ok, true)
  check('干净数据 · error 数', clean.counts.errors, 0)
  check('干净数据 · warning 数', clean.counts.warnings, 0)
  check('干净数据 · 未分类数', clean.counts.unclassified, 0)
  check('干净数据 · 可见数', clean.counts.visible, 1)
  check('干净数据 · source', clean.source, 'clean.json')

  /* ------------------------------------------------------------------ 脏数据 */
  const raw = {
    games: [
      {
        ...cleanGame(),
        id: 'a',
        title: 'Game A',
        status: 'published',
        tags: ['speedrun', 'Speedrun', '监控摄像头'],
        altTitles: ['Alias', 'alias'],
        platforms: ['windows', 'windows'],
        relations: [
          { type: 'sequel', targetId: 'b' },
          { type: 'related', targetId: 'b' },
          { type: 'related', targetId: 'a' },
          { type: 'related', targetId: 'missing' },
          { type: 'bogus', targetId: 'b' },
        ],
      },
      {
        ...cleanGame(),
        id: 'b',
        title: 'Game B',
        status: 'draft',
        platforms: ['web'],
        gameplayTypes: ['exploration'],
        mechanics: [],
        relations: [{ type: 'prequel', targetId: 'a' }],
      },
      {
        ...cleanGame(),
        id: 'c',
        title: 'Game C',
        coverImage: '',
        bannerImage: '',
        downloads: [],
        gameplayTypes: [],
        mechanics: [],
        platforms: ['nope'],
        developmentStatus: 'beta',
        relations: [],
      },
      { ...cleanGame(), id: 'a', title: 'Duplicate A' },
    ],
    taxonomy: {
      gameplayTypes: [
        { id: 'traditional-night-watch', name: '传统守夜式' },
        { id: 'traditional-night-watch', name: '重复 id' },
        { id: 'exploration', name: '探索式' },
      ],
      mechanics: [{ id: 'security-cameras', name: '监控摄像头' }],
      platforms: [{ id: 'windows', name: 'Windows' }],
    },
  }

  const report = analyzeCatalog(raw, 'dirty.json')
  const found = codes(report)
  check('脏数据 · ok=false', report.ok, false)
  check('脏数据 · 重复游戏 id', found.includes('game-duplicate-id'), true)
  check('脏数据 · 自关联', found.includes('relation-self'), true)
  check('脏数据 · 悬挂关系', found.includes('relation-dangling'), true)
  check('脏数据 · 非法关系类型', found.includes('relation-invalid-type'), true)
  check('脏数据 · 重复关系目标', found.includes('relation-duplicate'), true)
  check('脏数据 · 两端重复记录', found.includes('relation-reverse-duplicate'), true)
  check('脏数据 · 不可见目标', found.includes('relation-target-hidden'), true)
  check('脏数据 · 未分类', found.includes('unclassified'), true)
  check('脏数据 · 未分类列表包含 c', report.unclassifiedGames.map((game) => game.id).join(','), 'c')
  check('脏数据 · 失效词条', found.includes('unknown-vocabulary'), true)
  check('脏数据 · 标签与词条同名', found.includes('tag-overlaps-vocabulary'), true)
  check('脏数据 · 重复标签', found.includes('duplicate-tag'), true)
  check('脏数据 · 重复其他名称', found.includes('duplicate-alt-title'), true)
  check('脏数据 · 重复平台', found.includes('duplicate-platform'), true)
  check('脏数据 · 缺封面', found.includes('missing-cover'), true)
  check('脏数据 · 缺下载', found.includes('missing-downloads'), true)
  check('脏数据 · 非法开发状态', found.includes('invalid-development-status'), true)
  check('脏数据 · 词表结构问题', found.includes('taxonomy-issue'), true)
  check('脏数据 · 重复词条 id 被记录', report.issues.some((issue) => issue.message.includes('重复')), true)
  check('脏数据 · 统计 error > 0', report.counts.errors > 0, true)

  /* ------------------------------------------------------------------ 结构损坏 */
  const broken = analyzeCatalog(null, 'broken.json')
  check('缺少 games · 结构错误', broken.ok, false)
  check(
    '缺少 games · 报告代码',
    broken.issues.some((issue) => issue.code === 'catalog-games-missing'),
    true,
  )
  const invalidGame = analyzeCatalog({ games: [null, { title: 'no id' }], taxonomy: null })
  check(
    '非法条目 · 报告代码',
    invalidGame.issues.some((issue) => issue.code === 'game-invalid'),
    true,
  )

  return results
}
