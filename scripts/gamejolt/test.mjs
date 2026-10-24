/**
 * GameJolt 抓取 / 转换的单元测试。
 *
 * 运行：npm run test:gamejolt
 *
 * 这些测试**不联网**：fetchGameJoltGame 允许注入 fetchImpl，
 * 所以网络失败、概览失败、接口字段缺失都能在本地稳定复现。
 * 真实接口的形状会变，夹具里的字段名来自 2026-10 的实际响应。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DESCRIPTION_LIMIT,
  MAX_GALLERY,
  extractRichTextTags,
  normalizeGameJoltData,
  parseGameJoltInput,
  richTextToPlainText,
  upgradeMediaUrl,
} from './parse.mjs'
import { BROWSER_REQUEST_HEADERS, fetchGameJoltGame } from './fetch.mjs'

/* ==========================================================================
   一、链接解析
   ========================================================================== */

test('parseGameJoltInput：接受标准作品链接、子页面、裸 ID', () => {
  assert.equal(parseGameJoltInput('https://gamejolt.com/games/jolly3/338135').id, 338135)
  assert.equal(parseGameJoltInput('https://gamejolt.com/games/jolly3/338135/').id, 338135)
  assert.equal(parseGameJoltInput('https://gamejolt.com/games/jolly3/338135/comments').id, 338135)
  assert.equal(parseGameJoltInput('https://www.gamejolt.com/games/RDO/338135?ref=x').id, 338135)
  assert.equal(parseGameJoltInput('338135').id, 338135)
  assert.equal(parseGameJoltInput('gamejolt.com/games/RDO/338135').id, 338135)
})

test('parseGameJoltInput：拒绝非 GameJolt 域名和没有 ID 的链接', () => {
  assert.throws(
    () => parseGameJoltInput('https://example.com/games/jolly3/338135'),
    /只支持 gamejolt\.com/,
  )
  assert.throws(() => parseGameJoltInput('https://gamejolt.com/games/jolly3'), /找不到作品 ID/)
  assert.throws(() => parseGameJoltInput(''), /请粘贴/)
  assert.throws(() => parseGameJoltInput('https://gamejolt.com/games/a/0'), /找不到作品 ID/)
})

/* ==========================================================================
   二、富文本转换
   ========================================================================== */

function descriptionDoc() {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', marks: [{ type: 'strong' }], text: 'Prologue' },
          { type: 'hardBreak' },
          { type: 'text', text: 'A small family place.' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Custom night' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Voice acting' }] }],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '#FNAF', marks: [{ type: 'tag', attrs: { tag: 'FNAF' } }] },
          { type: 'text', text: ' #action' },
        ],
      },
    ],
  }
}

test('richTextToPlainText：段落、换行、列表和标签都变成可读文本', () => {
  const text = richTextToPlainText(JSON.stringify(descriptionDoc()))
  assert.match(text, /Prologue/)
  assert.match(text, /A small family place\./)
  assert.match(text, /- Custom night/)
  assert.match(text, /- Voice acting/)
  assert.match(text, /#FNAF/)
  assert.doesNotMatch(text, /"type"/)
})

test('richTextToPlainText：普通字符串与空值不会崩', () => {
  assert.equal(richTextToPlainText('hello'), 'hello')
  assert.equal(richTextToPlainText(''), '')
  assert.equal(richTextToPlainText(null), '')
  assert.equal(richTextToPlainText('{不是 JSON'), '{不是 JSON')
})

test('extractRichTextTags：同时取 tag mark 和正文 hashtag', () => {
  const tags = extractRichTextTags(JSON.stringify(descriptionDoc()))
  assert.deepEqual(tags, ['FNAF', '#FNAF', '#action'])
})

/* ==========================================================================
   三、图片 URL
   ========================================================================== */

test('upgradeMediaUrl：只替换尺寸段，保留其余路径和查询串', () => {
  assert.equal(
    upgradeMediaUrl('https://m.gjcdn.net/game-screenshot/400/170234-hwuagy5a-v4.webp?x=1', 1600),
    'https://m.gjcdn.net/game-screenshot/1600/170234-hwuagy5a-v4.webp?x=1',
  )
  assert.equal(upgradeMediaUrl('', 1600), '')
})

/* ==========================================================================
   四、总装
   ========================================================================== */

function makeScreenshot(index, width = 1280) {
  return {
    media_type: 'image',
    media_item: {
      id: 1000 + index,
      type: 'game-screenshot',
      img_url: `https://i.gjcdn.net/public-data/games/0/177/123/screenshots/${index}.png`,
      mediaserver_url: `https://m.gjcdn.net/game-screenshot/400/${1000 + index}-hash${index}-v4.webp`,
      width,
      height: Math.round(width * 0.75),
      is_animated: false,
    },
  }
}

function detailFixture(overrides = {}) {
  return {
    payload: {
      game: {
        id: 123,
        title: 'Test FNAF Game',
        slug: 'test-fnaf-game',
        developer: { display_name: 'Tester' },
        published_on: Date.UTC(2020, 4, 1),
        posted_on: Date.UTC(2020, 3, 1),
        creation_tool_human: 'Clickteam Series',
        category: 'horror',
        description_content: JSON.stringify(descriptionDoc()),
        thumbnail_media_item: {
          img_url: 'https://i.gjcdn.net/public-data/games/0/177/123/thumb.png',
          mediaserver_url: 'https://m.gjcdn.net/game-thumbnail/500/123-thumb-v4.webp',
          width: 1280,
          height: 720,
          is_animated: false,
        },
        header_media_item: {
          img_url: 'https://i.gjcdn.net/public-data/games/0/177/123/header.png',
          mediaserver_url: 'https://m.gjcdn.net/game-header/950/123-head-v4.webp',
          width: 950,
          height: 350,
          is_animated: false,
        },
        ...overrides,
      },
    },
  }
}

function overviewFixture() {
  return {
    payload: {
      metaDescription: '🎮 A small family place.',
      mediaItems: [
        ...Array.from({ length: 10 }, (_, index) => makeScreenshot(index)),
        makeScreenshot(99, 300),
        {
          media_type: 'video',
          type: 'youtube',
          url: 'YZOkpiBGdLE',
          title: 'Teaser',
        },
      ],
    },
  }
}

test('normalizeGameJoltData：字段、图片尺寸、图库上限和标签都正确', () => {
  const data = normalizeGameJoltData(
    detailFixture(),
    overviewFixture(),
    'https://gamejolt.com/games/test-fnaf-game/123',
  )

  assert.equal(data.gameJoltId, 123)
  assert.equal(data.title, 'Test FNAF Game')
  assert.equal(data.author, 'Tester')
  assert.equal(data.releaseYear, 2020)
  assert.equal(data.engine, 'Clickteam')
  assert.equal(data.ipSeries, 'FNAF')
  assert.equal(data.sourceUrl, 'https://gamejolt.com/games/test-fnaf-game/123')
  assert.equal(data.videoUrl, 'https://www.youtube.com/watch?v=YZOkpiBGdLE')

  assert.match(data.coverImage, /\/game-thumbnail\/1000\//)
  assert.match(data.bannerImage, /\/game-header\/1600\//)
  assert.equal(data.gallery.length, MAX_GALLERY)
  assert.ok(data.gallery.every((url) => url.includes('/game-screenshot/1600/')))
  assert.ok(data.warnings.some((warning) => warning.includes('截图')))

  assert.ok(data.tags.includes('FNAF'))
  assert.ok(data.tags.includes('action'))
  assert.ok(data.tags.includes('horror'))
  assert.equal(new Set(data.tags.map((tag) => tag.toLowerCase())).size, data.tags.length)

  assert.match(data.description, /A small family place/)
  assert.ok(data.shortDescription.length > 0)
  assert.ok(data.shortDescription.length <= 120)
})

test('normalizeGameJoltData：没有 Banner 时用封面兜底，并给出警告', () => {
  const detail = detailFixture({ header_media_item: null })
  const data = normalizeGameJoltData(detail, overviewFixture(), '123')
  assert.match(data.bannerImage, /\/game-thumbnail\/1000\//)
  assert.ok(data.warnings.some((warning) => warning.includes('Banner')))
})

test('normalizeGameJoltData：没有图片时保持空值，不伪造地址', () => {
  const overview = { payload: { mediaItems: [] } }
  const detail = detailFixture({ thumbnail_media_item: null, header_media_item: null })
  const data = normalizeGameJoltData(detail, overview, '123')
  assert.equal(data.coverImage, '')
  assert.equal(data.bannerImage, '')
  assert.deepEqual(data.gallery, [])
  assert.ok(data.warnings.some((warning) => warning.includes('没有提供任何图片')))
})

test('normalizeGameJoltData：超长简介截断到后台允许的上限', () => {
  const longText = 'A'.repeat(DESCRIPTION_LIMIT + 800)
  const detail = detailFixture({
    description_content: JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }],
    }),
  })
  const data = normalizeGameJoltData(detail, overviewFixture(), '123')
  assert.ok(data.description.length <= DESCRIPTION_LIMIT)
  assert.ok(data.description.endsWith('…'))
  assert.ok(data.warnings.some((warning) => warning.includes('已截断')))
})

test('normalizeGameJoltData：发布日期无效时退回 posted_on，再不行用今年', () => {
  const fallback = normalizeGameJoltData(
    detailFixture({ published_on: null, posted_on: Date.UTC(2018, 0, 1) }),
    overviewFixture(),
    '123',
  )
  assert.equal(fallback.releaseYear, 2018)

  const missing = normalizeGameJoltData(
    detailFixture({ published_on: null, posted_on: null }),
    overviewFixture(),
    '123',
  )
  assert.equal(missing.releaseYear, new Date().getUTCFullYear())
  assert.ok(missing.warnings.some((warning) => warning.includes('年份')))
})

test('normalizeGameJoltData：缺标题直接报错，缺作者只警告', () => {
  assert.throws(
    () => normalizeGameJoltData(detailFixture({ title: '' }), overviewFixture(), '123'),
    /没有标题/,
  )
  const data = normalizeGameJoltData(
    detailFixture({ developer: {} }),
    overviewFixture(),
    '123',
  )
  assert.equal(data.author, '')
  assert.ok(data.warnings.some((warning) => warning.includes('作者')))
})

/* ==========================================================================
   五、网络层（注入假 fetch，不联网）
   ========================================================================== */

test('fetchGameJoltGame：详情成功、概览失败时仍返回带警告的数据', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(url)
    if (url.includes('/overview/')) {
      return new Response('oops', { status: 500 })
    }
    return new Response(JSON.stringify(detailFixture()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const data = await fetchGameJoltGame('https://gamejolt.com/games/test-fnaf-game/123', {
    fetchImpl: fakeFetch,
  })

  assert.equal(data.title, 'Test FNAF Game')
  assert.ok(calls.some((url) => url.includes('/discover/games/123')))
  assert.ok(calls.some((url) => url.includes('/overview/123')))
  assert.ok(data.warnings.some((warning) => warning.includes('截图')))
})

test('fetchGameJoltGame：可以传入浏览器安全请求头（扩展场景）', async () => {
  const seen = []
  const fakeFetch = async (_url, init) => {
    seen.push(init?.headers)
    return new Response(JSON.stringify(detailFixture()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await fetchGameJoltGame('123', {
    fetchImpl: fakeFetch,
    headers: BROWSER_REQUEST_HEADERS,
  })

  assert.equal(seen.length, 2)
  for (const headers of seen) {
    assert.equal(headers.accept, 'application/json, text/plain, */*')
    assert.equal(headers['user-agent'], undefined)
    assert.equal(headers.referer, undefined)
  }
})

test('fetchGameJoltGame：非法链接在发请求前就被拒绝', async () => {
  let called = false
  const fakeFetch = async () => {
    called = true
    return new Response('{}')
  }

  await assert.rejects(
    () => fetchGameJoltGame('https://example.com/games/x/1', { fetchImpl: fakeFetch }),
    /只支持 gamejolt\.com/,
  )
  assert.equal(called, false)
})
