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

  const dirtySnapshot = JSON.stringify(raw)
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
  check('只读 · 脏数据检查不修改入参', JSON.stringify(raw), dirtySnapshot)

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

  /* ------------------------------------------------------------------ 不可信 JSON */
  for (const rawRoot of [null, [], 'not-an-object', 42] as unknown[]) {
    const rootReport = analyzeCatalog(rawRoot)
    check(
      `异常根 ${JSON.stringify(rawRoot)} · 报 catalog-root-invalid`,
      rootReport.issues.some((issue) => issue.code === 'catalog-root-invalid'),
      true,
    )
  }
  const noGames = analyzeCatalog({ games: {} })
  check(
    'games 不是数组 · 报 catalog-games-missing',
    noGames.issues.some((issue) => issue.code === 'catalog-games-missing'),
    true,
  )

  const nonObjectRecords = analyzeCatalog({
    games: [null, 7, 'game', { ...cleanGame(), id: 'ok' }],
    taxonomy: cleanTaxonomy(),
  })
  check('非对象记录 · 报 game-invalid', codes(nonObjectRecords).includes('game-invalid'), true)
  check('非对象记录 · 仍检查其他记录', nonObjectRecords.counts.games, 1)
  check(
    '非对象记录 · 正常记录不误报',
    nonObjectRecords.issues.some((issue) => issue.gameId === 'ok'),
    false,
  )

  const idReport = analyzeCatalog({
    games: [
      { title: 'no id' },
      { ...cleanGame(), id: '   ' },
      { ...cleanGame(), id: 'dup' },
      { ...cleanGame(), id: 'dup' },
    ],
    taxonomy: cleanTaxonomy(),
  })
  check(
    'id 缺失 / 空白 · 逐条报 game-invalid',
    idReport.issues.filter((issue) => issue.code === 'game-invalid').length,
    2,
  )
  check('重复 id · 报 game-duplicate-id', codes(idReport).includes('game-duplicate-id'), true)
  check('重复 id · 只检查第一条', idReport.counts.games, 1)

  const textCases = analyzeCatalog({
    games: [
      { ...cleanGame(), id: 'title-missing', title: undefined },
      { ...cleanGame(), id: 'title-null', title: null },
      { ...cleanGame(), id: 'title-number', title: 3 },
      { ...cleanGame(), id: 'author-missing', author: undefined },
      { ...cleanGame(), id: 'author-null', author: null },
    ],
    taxonomy: cleanTaxonomy(),
  })
  check(
    '标题缺失 · missing-title',
    textCases.issues.filter((issue) => issue.code === 'missing-title').length,
    1,
  )
  check(
    '标题为 null / 类型错误 · invalid-title',
    textCases.issues.filter((issue) => issue.code === 'invalid-title').length,
    2,
  )
  check(
    '作者缺失 · missing-author',
    textCases.issues.filter((issue) => issue.code === 'missing-author').length,
    1,
  )
  check(
    '作者类型错误 · invalid-author',
    textCases.issues.filter((issue) => issue.code === 'invalid-author').length,
    1,
  )

  const imageCases = analyzeCatalog({
    games: [
      { ...cleanGame(), id: 'cover-missing', coverImage: undefined },
      { ...cleanGame(), id: 'cover-null', coverImage: null },
      { ...cleanGame(), id: 'banner-missing', bannerImage: undefined },
      { ...cleanGame(), id: 'banner-null', bannerImage: null },
    ],
    taxonomy: cleanTaxonomy(),
  })
  check('封面缺失 · missing-cover', codes(imageCases).includes('missing-cover'), true)
  check('封面类型错误 · invalid-cover', codes(imageCases).includes('invalid-cover'), true)
  check('Banner 缺失 · missing-banner', codes(imageCases).includes('missing-banner'), true)
  check('Banner 类型错误 · invalid-banner', codes(imageCases).includes('invalid-banner'), true)

  const downloadCases = analyzeCatalog({
    games: [
      { ...cleanGame(), id: 'dl-missing', downloads: undefined },
      { ...cleanGame(), id: 'dl-null', downloads: null },
      { ...cleanGame(), id: 'dl-object', downloads: {} },
      {
        ...cleanGame(),
        id: 'dl-items',
        downloads: [
          null,
          { provider: 1, url: '' },
          { provider: 'Drive', url: 'https://example.com/x', password: 5 },
        ],
      },
    ],
    taxonomy: cleanTaxonomy(),
  })
  check('下载缺失 · missing-downloads', codes(downloadCases).includes('missing-downloads'), true)
  check(
    '下载不是数组 · invalid-downloads',
    downloadCases.issues.filter((issue) => issue.code === 'invalid-downloads').length,
    2,
  )
  check(
    '下载元素格式错误 · 逐项 invalid-download',
    downloadCases.issues.filter((issue) => issue.code === 'invalid-download').length >= 4,
    true,
  )

  const relationCases = analyzeCatalog({
    games: [
      { ...cleanGame(), id: 'rel-object', relations: {} },
      {
        ...cleanGame(),
        id: 'rel-items',
        relations: [
          5,
          { type: 'related' },
          { type: 'related', targetId: 9 },
          { type: 'bogus', targetId: 'rel-object' },
        ],
      },
    ],
    taxonomy: cleanTaxonomy(),
  })
  check('relations 不是数组 · relation-not-array', codes(relationCases).includes('relation-not-array'), true)
  check('关系元素不是对象 · relation-invalid', codes(relationCases).includes('relation-invalid'), true)
  check('关系目标为空 · relation-empty-target', codes(relationCases).includes('relation-empty-target'), true)
  check('关系目标类型错误 · relation-invalid-target', codes(relationCases).includes('relation-invalid-target'), true)
  check('关系类型非法 · relation-invalid-type', codes(relationCases).includes('relation-invalid-type'), true)

  const listCases = analyzeCatalog({
    games: [
      { ...cleanGame(), id: 'tags-bad', tags: 5 },
      { ...cleanGame(), id: 'tags-items', tags: ['ok', 5] },
      { ...cleanGame(), id: 'vocab-bad', gameplayTypes: 'traditional-night-watch' },
      { ...cleanGame(), id: 'vocab-items', mechanics: [1, 'security-cameras'] },
    ],
    taxonomy: cleanTaxonomy(),
  })
  check('标签不是数组 · invalid-tags', codes(listCases).includes('invalid-tags'), true)
  check('玩法字段不是数组 · invalid-gameplay-types', codes(listCases).includes('invalid-gameplay-types'), true)
  check('机制含非字符串 · invalid-mechanics', codes(listCases).includes('invalid-mechanics'), true)

  const yearCases = analyzeCatalog({
    games: [
      { ...cleanGame(), id: 'year-string', releaseYear: '2020' },
      { ...cleanGame(), id: 'year-future', releaseYear: 2999 },
    ],
    taxonomy: cleanTaxonomy(),
  })
  check('年份类型错误 · invalid-year', codes(yearCases).includes('invalid-year'), true)
  check('年份越界 · implausible-year', codes(yearCases).includes('implausible-year'), true)

  const weird = {
    games: [
      {
        id: 'weird',
        title: null,
        author: 7,
        downloads: null,
        tags: 3,
        relations: [null],
      },
    ],
    taxonomy: null,
  }
  const weirdSnapshot = JSON.stringify(weird)
  analyzeCatalog(weird)
  check('只读 · 异常输入不被修改', JSON.stringify(weird), weirdSnapshot)

  return results
}
