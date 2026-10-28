/**
 * 作品写入的领域约束（纯函数）。
 *
 * 这里是**写入信任边界**的唯一判据：编辑器的字段级校验只是它的展示投影，
 * 批量操作、导入、仓储 API 都必须在落库前经过同一套规则。
 *
 * 只校验本次 patch 明确碰到的字段 —— 历史数据里与本次编辑无关的异常
 * 不应阻塞保存（例如旧记录的悬挂关系不应让一次改名失败）。
 */
import {
  ALT_TITLE_LIMITS,
  DRAFT_LIMITS,
  DOWNLOAD_LIMITS,
  IMAGE_LIMITS,
  TAG_LIMITS,
  YEAR_RANGE,
  isValidAltTitle,
  isValidImageRef,
  isValidTag,
  validateDownload,
  type AdminGame,
  type GamePatch,
} from '../types/admin'
import {
  GAME_VOCABULARY_LIMITS,
  VOCABULARY_COLLECTIONS,
  VOCABULARY_LABELS,
  type Taxonomy,
  type VocabularyCollection,
} from '../types/taxonomy'
import { DEVELOPMENT_STATUSES } from '../types/game'
import { validateRelationInput } from './relations'
import { resolveVocabularyEntry } from './taxonomy'

function asText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

/** 上线前必须齐全的三项；草稿 / 下线不检查 */
export function gamePublishIssues(
  game: Pick<AdminGame, 'coverImage' | 'bannerImage' | 'downloads'>,
): string[] {
  const issues: string[] = []
  if (!asText(game.coverImage).trim()) issues.push('还没有封面图')
  if (!asText(game.bannerImage).trim()) issues.push('还没有 Banner 宣传图')
  if (!Array.isArray(game.downloads) || game.downloads.length === 0) {
    issues.push('还没有下载渠道')
  }
  return issues
}

function checkText(
  errors: string[],
  label: string,
  value: unknown,
  max: number,
  options: { required?: boolean } = {},
): void {
  if (typeof value !== 'string') {
    errors.push(`${label}必须是文本`)
    return
  }
  const text = value.trim()
  if (options.required && !text) {
    errors.push(`${label}不能为空`)
    return
  }
  if (text.length > max) errors.push(`${label}不能超过 ${max} 个字符`)
}

function checkUrl(errors: string[], label: string, value: unknown): void {
  const text = asText(value).trim()
  if (text && !/^https?:\/\/\S+$/i.test(text)) {
    errors.push(`${label}必须是 http:// 或 https:// 开头的完整链接`)
  }
}

function checkImage(errors: string[], label: string, value: unknown): void {
  const text = asText(value).trim()
  if (!text) return
  if (text.length > IMAGE_LIMITS.maxLength) {
    errors.push(`${label}不能超过 ${IMAGE_LIMITS.maxLength} 个字符`)
  } else if (!isValidImageRef(text)) {
    errors.push(`${label}必须是站内图片路径或完整的 http(s) 图片地址`)
  }
}

function checkVocabulary(
  errors: string[],
  collection: VocabularyCollection,
  values: unknown,
  taxonomy: Taxonomy,
): void {
  const label = VOCABULARY_LABELS[collection]
  if (!Array.isArray(values)) {
    errors.push(`${label}必须是数组`)
    return
  }
  const limit = GAME_VOCABULARY_LIMITS[collection]
  if (values.length > limit) {
    errors.push(`${label}最多 ${limit} 个`)
    return
  }
  const unknown = values.filter(
    (value) => typeof value !== 'string' || !resolveVocabularyEntry(taxonomy, collection, value),
  )
  if (unknown.length > 0) {
    errors.push(`${label}里有已失效的词条：${unknown.join('、')}，请移除后重选`)
  }
}

/**
 * 校验一次写入。`current` 为 null 表示新建。
 *
 * 上线门槛只在「本次写入可能影响上线完整性」时检查：
 * 切到 published，或改动封面 / Banner / 下载渠道。这样批量改标签、归档、
 * 下线不会被旧记录里与本次无关的缺口挡住。
 */
export function validateGameWrite(
  patch: GamePatch,
  next: AdminGame,
  taxonomy: Taxonomy,
): string[] {
  const errors: string[] = []
  const touched = (key: keyof GamePatch): boolean =>
    (patch as Record<string, unknown>)[key] !== undefined

  if (touched('title')) {
    checkText(errors, '游戏名称', next.title, DRAFT_LIMITS.title, { required: true })
  }
  if (touched('author')) {
    checkText(errors, '作者', next.author, DRAFT_LIMITS.author, { required: true })
  }
  if (touched('releaseYear')) {
    const year = Number(next.releaseYear)
    if (!Number.isInteger(year) || !/^\d{4}$/.test(String(year))) {
      errors.push('发行年份必须是 4 位数字')
    } else if (year < YEAR_RANGE.min) {
      errors.push(`发行年份不能早于 ${YEAR_RANGE.min}`)
    } else if (year > YEAR_RANGE.max) {
      errors.push(`发行年份不能晚于 ${YEAR_RANGE.max}`)
    }
  }
  if (touched('ipSeries')) {
    checkText(errors, 'IP 系列', next.ipSeries, DRAFT_LIMITS.ipSeries, { required: true })
  }
  if (touched('engine')) {
    checkText(errors, '开发引擎', next.engine, DRAFT_LIMITS.engine, { required: true })
  }
  if (touched('videoUrl')) checkUrl(errors, '视频地址', next.videoUrl)
  if (touched('shortDescription')) {
    checkText(errors, '一句话简介', next.shortDescription, DRAFT_LIMITS.shortDescription)
  }
  if (touched('description')) {
    checkText(errors, '简介', next.description, DRAFT_LIMITS.description, { required: true })
  }

  if (touched('status')) {
    const status = next.status
    if (status !== 'draft' && status !== 'published' && status !== 'offline') {
      errors.push('发布状态不合法')
    }
  }
  if (touched('developmentStatus')) {
    const status = (patch as Record<string, unknown>).developmentStatus
    if (typeof status !== 'string' || !(DEVELOPMENT_STATUSES as string[]).includes(status)) {
      errors.push('开发状态不合法')
    }
  }
  if (touched('featured') && typeof next.featured !== 'boolean') {
    errors.push('推荐位必须是布尔值')
  }
  if (touched('archived') && typeof next.archived !== 'boolean') {
    errors.push('归档标记必须是布尔值')
  }
  if (touched('sourceUrl')) {
    checkText(errors, '来源页', next.sourceUrl, DRAFT_LIMITS.sourceUrl)
    checkUrl(errors, '来源页', next.sourceUrl)
  }
  if (touched('sortOrder') && !Number.isInteger(Number(next.sortOrder))) {
    errors.push('排序权重必须是整数')
  }
  if (touched('coverImage')) checkImage(errors, '封面地址', next.coverImage)
  if (touched('bannerImage')) checkImage(errors, 'Banner 地址', next.bannerImage)

  if (touched('tags')) {
    if (!Array.isArray(next.tags)) {
      errors.push('标签必须是数组')
    } else {
      if (next.tags.length > TAG_LIMITS.maxPerGame) {
        errors.push(`标签最多 ${TAG_LIMITS.maxPerGame} 个`)
      }
      const seen = new Set<string>()
      for (const tag of next.tags) {
        if (!isValidTag(tag)) errors.push(`标签「${asText(tag)}」不合法`)
        else if (seen.has(tag)) errors.push(`标签「${tag}」重复`)
        else seen.add(tag)
      }
    }
  }

  if (touched('altTitles')) {
    const raw = (patch as Record<string, unknown>).altTitles
    const titles = Array.isArray(raw) ? raw : []
    if (!Array.isArray(raw)) errors.push('其他名称必须是数组')
    if (titles.length > ALT_TITLE_LIMITS.maxPerGame) {
      errors.push(`其他名称最多 ${ALT_TITLE_LIMITS.maxPerGame} 个`)
    }
    const seen = new Set<string>()
    for (const title of titles) {
      if (typeof title !== 'string') {
        errors.push('其他名称必须是文本')
        continue
      }
      const key = title.toLocaleLowerCase()
      if (!isValidAltTitle(title)) {
        errors.push(`其他名称不能超过 ${ALT_TITLE_LIMITS.maxLength} 个字符`)
      } else if (seen.has(key)) {
        errors.push(`其他名称「${title}」重复`)
      } else {
        seen.add(key)
      }
    }
  }

  if (touched('gallery')) {
    const gallery = Array.isArray(next.gallery) ? next.gallery : []
    if (gallery.length > IMAGE_LIMITS.maxGallery) {
      errors.push(`图库最多 ${IMAGE_LIMITS.maxGallery} 张`)
    }
    gallery.forEach((ref, index) => {
      const text = asText(ref).trim()
      if (!text) errors.push(`图库第 ${index + 1} 张图片地址为空`)
      else if (text.length > IMAGE_LIMITS.maxLength) {
        errors.push(`图库第 ${index + 1} 张图片地址不能超过 ${IMAGE_LIMITS.maxLength} 个字符`)
      } else if (!isValidImageRef(text)) {
        errors.push(`图库第 ${index + 1} 张图片地址不合法`)
      }
    })
  }

  if (touched('downloads')) {
    const downloads = Array.isArray(next.downloads) ? next.downloads : []
    if (downloads.length > DOWNLOAD_LIMITS.maxPerGame) {
      errors.push(`下载渠道最多 ${DOWNLOAD_LIMITS.maxPerGame} 个`)
    }
    downloads.forEach((link, index) => {
      if (
        !link ||
        typeof link.provider !== 'string' ||
        typeof link.url !== 'string' ||
        (link.password !== undefined && typeof link.password !== 'string')
      ) {
        errors.push(`下载渠道第 ${index + 1} 行格式不合法`)
        return
      }
      const message = validateDownload({
        provider: link.provider,
        url: link.url,
        password: link.password ?? '',
      })
      if (message) errors.push(`下载渠道第 ${index + 1} 行：${message}`)
    })
  }

  for (const collection of VOCABULARY_COLLECTIONS) {
    if (touched(collection)) {
      checkVocabulary(
        errors,
        collection,
        (patch as Record<string, unknown>)[collection],
        taxonomy,
      )
    }
  }

  if (touched('relations')) {
    errors.push(...validateRelationInput(patch.relations, next.id))
  }

  const publishTouched =
    touched('status') || touched('coverImage') || touched('bannerImage') || touched('downloads')
  if (next.status === 'published' && publishTouched) {
    const issues = gamePublishIssues(next)
    if (issues.length > 0) errors.push(`不能上线：${issues.join('、')}`)
  }

  return [...new Set(errors)]
}
