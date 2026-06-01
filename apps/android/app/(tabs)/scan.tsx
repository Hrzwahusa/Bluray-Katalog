import React, { useRef, useState, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import MlkitOcr from 'react-native-mlkit-ocr'
import {
  searchMovieFuzzy,
  getWikipediaDetails,
  searchMoviePoster,
  TMDB_ATTRIBUTION_NOTICE,
} from '@bluray-katalog/shared'
import type { WikidataMovie } from '@bluray-katalog/shared'
import { useI18n } from '../../lib/i18n'
import { TmdbLogo } from '../../lib/tmdb-logo'
import { saveStoredMovie } from '../../lib/movie-store'

type Step = 'camera' | 'processing' | 'search' | 'manual' | 'confirm' | 'saving' | 'done'

type ManualMovieForm = {
  title: string
  originalTitle: string
  year: string
  director: string
  genres: string
  cast: string
  runtime: string
  imdbId: string
  description: string
}

type GeminiMovieGuess = {
  title?: string
  originalTitle?: string
  year?: number
  director?: string
  genres?: string[]
  cast?: string[]
  runtime?: number
  imdbId?: string
  description?: string
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.').trim())
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return undefined
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => cleanString(entry))
    .filter((entry): entry is string => Boolean(entry))
}

function parseGeminiMovieGuess(raw: string): GeminiMovieGuess | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const jsonCandidate = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim()

  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>
    const guess: GeminiMovieGuess = {
      title: cleanString(parsed.title),
      originalTitle: cleanString(parsed.originalTitle),
      year: cleanNumber(parsed.year),
      director: cleanString(parsed.director),
      genres: cleanStringArray(parsed.genres),
      cast: cleanStringArray(parsed.cast),
      runtime: cleanNumber(parsed.runtime),
      imdbId: cleanString(parsed.imdbId),
      description: cleanString(parsed.description),
    }

    if (!guess.title) return null
    return guess
  } catch {
    const plainTitle = trimmed.replace(/^"|"$/g, '')
    return plainTitle ? { title: plainTitle } : null
  }
}

function buildGeminiFallbackCandidate(guess: GeminiMovieGuess): WikidataMovie | null {
  if (!guess.title) return null

  return {
    wikidataId: `gemini:${guess.title.toLowerCase().replace(/\s+/g, '-')}`,
    title: guess.title,
    originalTitle: guess.originalTitle,
    year: guess.year,
    genres: guess.genres ?? [],
    cast: guess.cast ?? [],
    director: guess.director,
    description: guess.description,
    imdbId: guess.imdbId,
    runtime: guess.runtime,
  }
}

function isSvgDerivedImageUrl(url?: string): boolean {
  if (!url) return false
  const normalized = url.toLowerCase()
  return normalized.endsWith('.svg') || normalized.includes('.svg?') || normalized.includes('.svg.')
}

function isLikelyPosterImageUrl(url?: string): boolean {
  if (!url) return false
  const normalized = url.toLowerCase()
  if (isSvgDerivedImageUrl(normalized)) return false
  if (normalized.includes('/wikipedia/en/')) return true
  return /poster|cover|blu[-_ ]?ray|dvd/.test(normalized)
}

function shouldSearchPoster(coverUrl?: string): boolean {
  if (!coverUrl) return true
  return !isLikelyPosterImageUrl(coverUrl)
}

function normalizeTitleCandidate(value: string): string {
  return value
    .replace(/^[\s\-–—:•·*_\[\]()+"'`]+/, '')
    .replace(/[\s\-–—:•·*_\[\]()+"'`]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function stripEdgeNoiseTokens(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean)
  while (tokens.length > 1 && /^[A-Za-z0-9]$/.test(tokens[0] ?? '')) {
    tokens.shift()
  }
  while (tokens.length > 1 && /^[A-Za-z0-9]$/.test(tokens[tokens.length - 1] ?? '')) {
    tokens.pop()
  }
  return tokens.join(' ')
}

function applyCommonOcrFixes(value: string): string {
  let fixed = value
  fixed = fixed.replace(/[|]/g, 'I')
  fixed = fixed.replace(/\s*[_~]\s*/g, '-')
  fixed = fixed.replace(/\s*[-–—]\s*/g, '-')
  fixed = fixed.replace(/\b([A-Z0-9]{3,})\b/g, (token) => token
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B'))
  return fixed
}

function refineRecognizedTitle(value: string): string {
  let refined = normalizeTitleCandidate(value)
  refined = stripEdgeNoiseTokens(refined)
  refined = applyCommonOcrFixes(refined)
  return normalizeTitleCandidate(refined)
}

function buildTokenSubsetVariants(value: string): string[] {
  const tokens = normalizeTitleCandidate(value).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  const variants = new Set<string>()
  const longTokens = tokens.filter((token) => token.length >= 4)

  variants.add(tokens[0] ?? '')
  if (tokens.length >= 2) {
    variants.add(tokens.slice(0, 2).join(' '))
    variants.add(tokens.slice(-2).join(' '))
    variants.add([tokens[0], tokens[tokens.length - 1]].join(' '))
  }

  if (longTokens.length >= 2) {
    variants.add(longTokens.join(' '))
  }

  return Array.from(variants)
    .map((entry) => normalizeTitleCandidate(entry))
    .filter((entry) => entry.length > 0)
}

function buildTokenOcrVariants(token: string): string[] {
  const normalized = normalizeTitleCandidate(token)
  if (!normalized) return []

  const variants = new Set<string>([normalized])
  const queue = [normalized]

  const pushVariant = (value: string) => {
    const cleaned = normalizeTitleCandidate(value)
    if (!cleaned || variants.has(cleaned) || variants.size >= 12) return
    variants.add(cleaned)
    if (queue.length < 12) {
      queue.push(cleaned)
    }
  }

  while (queue.length > 0 && variants.size < 12) {
    const current = queue.shift() ?? ''
    if (!current) continue

    pushVariant(current.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B'))
    pushVariant(current.replace(/W/g, 'M').replace(/w/g, 'm'))
    pushVariant(current.replace(/M/g, 'W').replace(/m/g, 'w'))

    if (/^sp/i.test(current) && !/^spi/i.test(current) && current.length >= 5) {
      pushVariant(`${current.slice(0, 2)}i${current.slice(2)}`)
    }

    if (/^st/i.test(current) && !/^sta/i.test(current) && current.length >= 5) {
      pushVariant(`${current.slice(0, 2)}a${current.slice(2)}`)
    }

    if (/^[tf][A-Za-z]{3,}$/.test(current)) {
      const first = current[0] ?? ''
      const swap = first === first.toUpperCase() ? (first === 'T' ? 'F' : 'T') : (first === 't' ? 'f' : 't')
      pushVariant(`${swap}${current.slice(1)}`)
    }

    if (/^[A-Za-z]{5,}$/.test(current)) {
      pushVariant(current.replace(/rn/gi, 'm'))
      pushVariant(current.replace(/vv/gi, 'w'))
    }
  }

  return Array.from(variants)
}

function normalizeMovieSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = new Array<number>(right.length + 1).fill(0)

  for (let i = 0; i < left.length; i += 1) {
    current[0] = i + 1
    for (let j = 0; j < right.length; j += 1) {
      const cost = left[i] === right[j] ? 0 : 1
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost
      )
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j]
    }
  }

  return previous[right.length] ?? Math.max(left.length, right.length)
}

function scoreTokenSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.82

  const maxLength = Math.max(left.length, right.length)
  if (maxLength < 4) return 0

  const distance = levenshteinDistance(left, right)
  if (distance === 1) return 0.88
  if (distance === 2 && maxLength >= 5) return 0.72
  if (distance === 3 && maxLength >= 5) return 0.52
  return 0
}

function scoreMovieAgainstQueryVariants(movie: WikidataMovie, queries: string[]): number {
  const haystacks = [movie.title, movie.originalTitle ?? '']
    .map((entry) => normalizeMovieSearchText(entry))
    .filter(Boolean)

  let bestScore = -1000

  for (const query of queries) {
    const normalizedQuery = normalizeMovieSearchText(query)
    if (!normalizedQuery) continue

    const queryTokens = normalizedQuery.split(' ').filter(Boolean)
    const haystackTokens = haystacks.flatMap((entry) => entry.split(' ').filter(Boolean))
    let score = 0

    if (haystacks.some((entry) => entry === normalizedQuery)) score += 220
    if (haystacks.some((entry) => entry.startsWith(normalizedQuery))) score += 130
    if (haystacks.some((entry) => entry.includes(normalizedQuery))) score += 90

    for (const token of queryTokens) {
      if (token.length < 3) continue
      const bestTokenScore = haystackTokens.reduce((best, candidate) => Math.max(best, scoreTokenSimilarity(token, candidate)), 0)
      score += Math.round(bestTokenScore * 28)
    }

    if (queryTokens.length >= 2) {
      const matchedTokens = queryTokens.filter((token) => haystackTokens.some((candidate) => scoreTokenSimilarity(token, candidate) >= 0.72)).length
      score += matchedTokens * 10
    }

    if (score > bestScore) {
      bestScore = score
    }
  }

  return bestScore
}

function scoreQueryVariantQuality(query: string): number {
  const normalized = normalizeTitleCandidate(query)
  if (!normalized) return -1000

  const tokens = normalized.split(/\s+/).filter(Boolean)
  const alphaOnly = normalized.replace(/[^A-Za-zÄÖÜäöüß]/g, '')
  const vowels = (alphaOnly.match(/[aeiouyäöü]/gi) ?? []).length
  const vowelRatio = alphaOnly.length > 0 ? vowels / alphaOnly.length : 0

  let score = 0

  if (tokens.length >= 1 && tokens.length <= 4) score += 14
  else if (tokens.length <= 6) score += 6
  else score -= 10

  if (normalized.length >= 5 && normalized.length <= 40) score += 10
  if (vowelRatio >= 0.28 && vowelRatio <= 0.65) score += 16
  else if (vowelRatio < 0.2) score -= 14

  for (const token of tokens) {
    if (token.length >= 4 && !/[aeiouyäöü]/i.test(token)) {
      score -= 8
    }

    if (/^sp/i.test(token) && !/^spi/i.test(token) && token.length >= 5) {
      score -= 7
    }
  }

  if (/\b(spider|spiderman|man|home|far|from|die|der|das|und|the|of|part|teil)\b/i.test(normalized)) {
    score += 8
  }

  return score
}

function isWeirdOcrTokenShape(token: string): boolean {
  const hasUpper = /[A-ZÄÖÜ]/.test(token)
  const hasLower = /[a-zäöüß]/.test(token)
  if (!hasUpper || !hasLower) return false
  return !/^[A-ZÄÖÜ][a-zäöüß]+$/.test(token)
}

function selectPreferredOcrDisplayVariant(variants: string[]): string {
  if (variants.length === 0) return ''

  const best = normalizeTitleCandidate(variants[0] ?? '')
  if (!best) return ''

  const bestTokens = best.split(/\s+/).filter(Boolean)
  if (bestTokens.length <= 1) return best

  const trailingTokens = bestTokens.slice(1)
  const trailingLooksNoisy =
    trailingTokens.some((token) => isWeirdOcrTokenShape(token))
    || (trailingTokens.length > 0 && trailingTokens.every((token) => token.length <= 5))

  if (!trailingLooksNoisy) {
    return best
  }

  const firstToken = bestTokens[0] ?? ''
  if (firstToken.length < 6) {
    return best
  }

  const firstStandalone = variants
    .map((entry) => normalizeTitleCandidate(entry))
    .find((entry) => entry.toLowerCase() === firstToken.toLowerCase())

  if (!firstStandalone) {
    return best
  }

  const bestScore = scoreQueryVariantQuality(best)
  const firstScore = scoreQueryVariantQuality(firstStandalone) + 6
  return firstScore >= bestScore ? firstStandalone : best
}

function buildSearchVariants(value: string): string[] {
  const base = refineRecognizedTitle(value)
  if (!base) return []

  const normalizedSpace = base.replace(/\s{2,}/g, ' ')
  const spaceVariant = normalizedSpace.replace(/-/g, ' ')
  const hyphenVariant = normalizedSpace.replace(/\s*[-–—]\s*/g, '-')
  const strippedPunctuation = normalizedSpace
    .replace(/[^A-Za-z0-9ÄÖÜäöüß\s-]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const swapWm = normalizedSpace
    .replace(/w/g, 'm')
    .replace(/W/g, 'M')

  const swapMw = normalizedSpace
    .replace(/m/g, 'w')
    .replace(/M/g, 'W')

  const fixSpPrefix = normalizedSpace
    .split(/\s+/)
    .map((token) => {
      if (/^sp/i.test(token) && !/^spi/i.test(token) && token.length >= 5) {
        return `${token.slice(0, 2)}i${token.slice(2)}`
      }
      return token
    })
    .join(' ')

  const removeLikelyNoiseWord = normalizedSpace
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .join(' ')

  const tokens = normalizedSpace.split(/\s+/).filter(Boolean)
  const tokenVariantLists = tokens.map((token) => buildTokenOcrVariants(token))
  const combinedTokenVariants = new Set<string>()

  const combineTokenVariants = (index: number, current: string[]) => {
    if (combinedTokenVariants.size >= 18) return
    if (index >= tokenVariantLists.length) {
      const combined = normalizeTitleCandidate(current.join(' '))
      if (combined) combinedTokenVariants.add(combined)
      return
    }

    for (const variant of tokenVariantLists[index].slice(0, 4)) {
      combineTokenVariants(index + 1, [...current, variant])
      if (combinedTokenVariants.size >= 18) return
    }
  }

  if (tokenVariantLists.length > 0) {
    combineTokenVariants(0, [])
  }

  const seedVariants = [
    normalizedSpace,
    spaceVariant,
    hyphenVariant,
    strippedPunctuation,
    swapWm,
    swapMw,
    fixSpPrefix,
    removeLikelyNoiseWord,
    ...buildTokenSubsetVariants(normalizedSpace),
    ...combinedTokenVariants,
  ]

  const chainedVariants = seedVariants.flatMap((entry) => {
    const fixedSp = entry
      .split(/\s+/)
      .map((token) => {
        if (/^sp/i.test(token) && !/^spi/i.test(token) && token.length >= 5) {
          return `${token.slice(0, 2)}i${token.slice(2)}`
        }
        return token
      })
      .join(' ')

    const swappedWm = entry
      .replace(/w/g, 'm')
      .replace(/W/g, 'M')

    const swappedMw = entry
      .replace(/m/g, 'w')
      .replace(/M/g, 'W')

    return [
      entry,
      fixedSp,
      swappedWm,
      swappedMw,
      fixedSp.replace(/w/g, 'm').replace(/W/g, 'M'),
      swappedWm
        .split(/\s+/)
        .map((token) => {
          if (/^sp/i.test(token) && !/^spi/i.test(token) && token.length >= 5) {
            return `${token.slice(0, 2)}i${token.slice(2)}`
          }
          return token
        })
        .join(' '),
    ]
  })

  return Array.from(new Set(chainedVariants.filter((entry) => entry.length > 0)))
    .filter((entry) => isUsefulTitleCandidate(entry))
}

const TITLE_NOISE_REGEX = /(blu[-\s]?ray|blu[-\s]?disc|disc|dvd|ultra\s*hd|4k|1080p|dolby|dts|edition|extended|unrated|special|collector|home\s*entertainment|pictures|studios|entertainment|fsk|freigegeben|ab\s*\d+|bonus|digital\s*copy|region\s*[a-c]|the\s*movie\s*database|tmdb)/i
const OCR_NOISE_FUZZY_REGEX = /(blu[a-z0-9]*ray|blu[a-z0-9]*dis[ck]|dvd|ultrahd|4k|1080p|dolby|dts|fsk|freigegeben|tmdb|themoviedatabase)/i
const STUDIO_HEADER_FUZZY_REGEX = /(marvel|warner|paramount|universal|sony|century|pictures|entertainment|studio|studios|studids)/i

type OcrLine = {
  text: string
  top: number
  height: number
}

function getFrameMetric(frame: unknown, key: 'x' | 'y' | 'width' | 'height'): number {
  if (!frame || typeof frame !== 'object') return 0
  const value = (frame as Record<string, unknown>)[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return 0
}

function normalizeForNoiseMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/5/g, 's')
    .replace(/8/g, 'b')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isLikelyTitleNoise(value: string): boolean {
  const directMatch = TITLE_NOISE_REGEX.test(value)
  const normalized = normalizeForNoiseMatch(value)
  if (!normalized) return true

  if (directMatch) return true
  if (OCR_NOISE_FUZZY_REGEX.test(normalized)) return true

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length <= 4 && STUDIO_HEADER_FUZZY_REGEX.test(normalized) && /(studio|studios|studids)/.test(normalized)) {
    return true
  }

  return false
}

function isUsefulTitleCandidate(value: string): boolean {
  const normalized = normalizeTitleCandidate(value)
  if (!normalized) return false
  if (!/[A-Za-zÄÖÜäöüß]/.test(normalized)) return false

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  if (isLikelyTitleNoise(normalized)) return false

  return true
}

function scoreTitleCandidate(value: string, top: number): number {
  const normalized = normalizeTitleCandidate(value)
  if (!normalized) return -1000
  if (!/[A-Za-zÄÖÜäöüß]/.test(normalized)) return -1000
  if (!isUsefulTitleCandidate(normalized)) return -1000

  let score = 0
  const length = normalized.length

  if (length >= 7 && length <= 48) score += 16
  else if (length >= 4 && length <= 64) score += 8
  else score -= 12

  if (isLikelyTitleNoise(normalized)) score -= 40
  if (/(marvel\s*studios|warner\s*bros|universal|paramount|sony\s*pictures|20th\s*century)/i.test(normalized)) score -= 60

  if (/[:\-]/.test(normalized)) score += 4
  if (/\d/.test(normalized)) score -= 2

  const upperCaseLetters = normalized.replace(/[^A-ZÄÖÜ]/g, '').length
  const alphaChars = normalized.replace(/[^A-Za-zÄÖÜäöüß]/g, '').length
  const upperRatio = alphaChars > 0 ? upperCaseLetters / alphaChars : 0
  if (upperRatio >= 0.55) score += 5

  // Blu-ray titles are often in the upper half of the cover.
  if (top > 0 && top < 0.62) score += 8
  else if (top >= 0.62) score -= 5

  return score
}

function extractTitleCandidatesFromMlkitBlocks(blocks: Array<{ text?: string; frame?: unknown; lines?: Array<{ text?: string; frame?: unknown }> }>): string[] {
  const lines: OcrLine[] = []

  for (const block of blocks) {
    const blockY = getFrameMetric(block.frame, 'y')
    const blockHeight = getFrameMetric(block.frame, 'height')

    if (Array.isArray(block.lines) && block.lines.length > 0) {
      for (const line of block.lines) {
        const text = normalizeTitleCandidate(line.text ?? '')
        if (!text) continue
        const lineY = getFrameMetric(line.frame, 'y')
        const lineHeight = getFrameMetric(line.frame, 'height')
        lines.push({
          text,
          top: lineY > 0 ? lineY : blockY,
          height: lineHeight > 0 ? lineHeight : blockHeight,
        })
      }
      continue
    }

    const blockText = normalizeTitleCandidate(block.text ?? '')
    if (!blockText) continue
    lines.push({ text: blockText, top: blockY, height: blockHeight })
  }

  if (lines.length === 0) return []

  const sortedByTop = [...lines].sort((left, right) => left.top - right.top)
  const candidateScores = new Map<string, number>()

  const addCandidate = (candidate: string, score: number) => {
    const normalized = refineRecognizedTitle(candidate)
    if (!normalized) return
    if (!isUsefulTitleCandidate(normalized)) return
    const currentBest = candidateScores.get(normalized) ?? -1000
    if (score > currentBest) {
      candidateScores.set(normalized, score)
    }
  }

  for (let index = 0; index < sortedByTop.length; index += 1) {
    const current = sortedByTop[index]

    const singleScore = scoreTitleCandidate(current.text, current.top)
    addCandidate(current.text, singleScore)

    const next = sortedByTop[index + 1]
    if (!next) continue

    const verticalGap = Math.abs(next.top - current.top)
    const threshold = Math.max(current.height, next.height, 0.045)
    if (verticalGap > threshold * 1.8) continue

    const merged = normalizeTitleCandidate(`${current.text} ${next.text}`)
    const mergedTop = current.top > 0 ? current.top : next.top
    const mergedScore = scoreTitleCandidate(merged, mergedTop) + 6
    addCandidate(merged, mergedScore)
  }

  const ranked = Array.from(candidateScores.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return right[0].length - left[0].length
    })
    .map(([candidate]) => candidate)

  if (ranked.length > 0) {
    return ranked.slice(0, 8)
  }

  return sortedByTop
    .map((line) => refineRecognizedTitle(line.text))
    .filter((line) => line.length > 0)
    .filter((line) => isUsefulTitleCandidate(line))
    .slice(0, 8)
}

function extractTitleFromOcr(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeTitleCandidate(line))
    .filter((line) => line.length > 2 && line.length < 64)
    .filter((line) => /[A-Za-zÄÖÜäöüß]/.test(line))
    .filter((line) => !/(blu-ray|bluray|ultra hd|4k|1080p|dolby|dts|version|edition|extended|unrated|special|collector)/i.test(line))

  if (lines.length === 0) {
    return normalizeTitleCandidate(text.split(/\r?\n/)[0] ?? '')
  }

  return lines.sort((left, right) => right.length - left.length)[0] ?? ''
}

async function recognizeTitleFromImage(base64: string | null, uri: string): Promise<{ title: string; guess: GeminiMovieGuess | null; alternatives: string[] }> {
  const geminiKey = await SecureStore.getItemAsync('geminiKey')

  if (geminiKey && base64) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: 'image/jpeg', data: base64 } },
                {
                  text: 'You are analyzing a Blu-ray or DVD movie cover photo. Return STRICT JSON only (no markdown, no commentary) with this shape: {"title":""}. The title must be the main movie title from the cover. Do not include any other fields. If uncertain, return the best plausible main title only.',
                },
              ],
            }],
          }),
        }
      )
      const json = await resp.json()
      const rawText = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
      const guess = parseGeminiMovieGuess(rawText)
      const title = normalizeTitleCandidate(guess?.title ?? '')
      if (title) {
        return { title, guess, alternatives: [title] }
      }
    } catch {
      // Fall through to on-device OCR.
    }
  }

  try {
    const blocks = await MlkitOcr.detectFromUri(uri)
    const titleCandidates = extractTitleCandidatesFromMlkitBlocks(
      blocks as Array<{ text?: string; frame?: unknown; lines?: Array<{ text?: string; frame?: unknown }> }>
    )
    if (titleCandidates.length > 0) {
      return { title: titleCandidates[0] ?? '', guess: null, alternatives: titleCandidates }
    }

    const rawText = blocks
      .flatMap((block) => [block.text, ...(block.lines ?? []).map((line) => line.text)])
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      .join('\n')

    const fallbackTitle = refineRecognizedTitle(extractTitleFromOcr(rawText))
    return {
      title: fallbackTitle,
      guess: null,
      alternatives: fallbackTitle ? [fallbackTitle] : [],
    }
  } catch {
    return { title: '', guess: null, alternatives: [] }
  }
}

export default function ScanScreen() {
  const { t } = useI18n()

  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)

  const [step, setStep] = useState<Step>('camera')
  const [capturedUri, setCapturedUri] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [candidates, setCandidates] = useState<WikidataMovie[]>([])
  const [selectedMovie, setSelectedMovie] = useState<WikidataMovie | null>(null)
  const [manualForm, setManualForm] = useState<ManualMovieForm>({
    title: '',
    originalTitle: '',
    year: '',
    director: '',
    genres: '',
    cast: '',
    runtime: '',
    imdbId: '',
    description: '',
  })
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [ocrAlternatives, setOcrAlternatives] = useState<string[]>([])

  const parseCsv = (value: string): string[] => value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const parseOptionalNumber = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed.replace(',', '.'))
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined
  }

  // ── Foto aufnehmen ──────────────────────────────────────────────────
  const takePicture = useCallback(async () => {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true })
      if (!photo?.uri) return
      setCapturedUri(photo.uri)
      setStep('processing')
      await runTitleRecognition(photo.base64 ?? null, photo.uri)
    } catch (e) {
      setError(t('scan.cameraError', { message: (e as Error).message }))
      setStep('search')
    }
  }, [t])

  // ── Galerie auswählen ───────────────────────────────────────────────
  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setCapturedUri(asset.uri)
    setStep('processing')
    await runTitleRecognition(asset.base64 ?? null, asset.uri)
  }, [])

  // ── Titel-Erkennung mit Gemini oder ML Kit ──────────────────────────
  const runTitleRecognition = async (base64: string | null, uri: string) => {
    try {
      setStatus(t('scan.ocrRunning'))
      const result = await recognizeTitleFromImage(base64, uri)
      const normalizedAlternatives = Array.from(new Set(
        (result.alternatives.length > 0 ? result.alternatives : [result.title])
          .flatMap((entry) => buildSearchVariants(entry))
          .filter((entry) => entry.length > 0)
      ))
        .sort((left, right) => scoreQueryVariantQuality(right) - scoreQueryVariantQuality(left))

      console.log('[scan-ocr] mlkit:candidates', {
        title: result.title,
        alternatives: result.alternatives.slice(0, 8),
        variants: normalizedAlternatives.slice(0, 16),
      })

      const title = selectPreferredOcrDisplayVariant(normalizedAlternatives)

      console.log('[scan-ocr] mlkit:selected-title', {
        selected: title,
        topVariant: normalizedAlternatives[0] ?? '',
      })

      setOcrAlternatives(normalizedAlternatives.slice(0, 8))
      setOcrText(title)
      setSearchQuery(title)
      setStep('search')
    } catch (e) {
      setError(t('scan.ocrError', { message: (e as Error).message }))
      setStep('search')
    } finally {
      setStatus('')
    }
  }

  // ── Wikidata-Suche ──────────────────────────────────────────────────
  const doSearch = async (query: string, geminiGuess?: GeminiMovieGuess | null) => {
    if (!query.trim()) return
    try {
      setStatus(t('scan.searchRunning'))
      setError(null)
      setCandidates([])

      const queryTrimmed = query.trim()
      const queryVariants = Array.from(new Set([
        ...buildSearchVariants(queryTrimmed),
        ...ocrAlternatives.flatMap((entry) => buildSearchVariants(entry)),
      ].filter((entry) => entry.length > 0)))
        .sort((left, right) => scoreQueryVariantQuality(right) - scoreQueryVariantQuality(left))
        .slice(0, 20)

      console.log('[scan-ocr] search:variants', {
        query: queryTrimmed,
        variants: queryVariants,
      })

      const mergedResults = new Map<string, WikidataMovie>()

      for (const variant of queryVariants) {
        const results = await searchMovieFuzzy(variant)
        if (results.length > 0) {
          for (const result of results) {
            mergedResults.set(result.wikidataId, result)
          }
        }
      }

      if (mergedResults.size > 0) {
        const rankedResults = Array.from(mergedResults.values())
          .sort((left, right) => {
            const leftScore = scoreMovieAgainstQueryVariants(left, queryVariants)
            const rightScore = scoreMovieAgainstQueryVariants(right, queryVariants)
            if (leftScore !== rightScore) return rightScore - leftScore
            if ((left.year ?? 0) !== (right.year ?? 0)) return (right.year ?? 0) - (left.year ?? 0)
            return left.title.localeCompare(right.title)
          })

        console.log('[scan-ocr] search:ranked-top', rankedResults.slice(0, 5).map((entry) => ({
          title: entry.title,
          originalTitle: entry.originalTitle,
          year: entry.year,
          score: scoreMovieAgainstQueryVariants(entry, queryVariants),
        })))

        setCandidates(rankedResults)
        const bestQuery = queryVariants[0] ?? queryTrimmed
        if (bestQuery !== queryTrimmed) {
          setSearchQuery(bestQuery)
        }
        return
      }

      const fallback = geminiGuess ? buildGeminiFallbackCandidate(geminiGuess) : null
      if (fallback) {
        setCandidates([fallback])
        return
      }

      setError(t('scan.searchNoneFound'))
    } catch (e) {
      setError(t('scan.searchError', { message: (e as Error).message }))
    } finally {
      setStatus('')
    }
  }

  const startManualTitleSearch = useCallback(() => {
    setCapturedUri(null)
    setOcrText('')
    setOcrAlternatives([])
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('search')
  }, [])

  const backToCamera = useCallback(() => {
    setCapturedUri(null)
    setOcrText('')
    setSearchQuery('')
    setOcrAlternatives([])
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('camera')
  }, [])

  const openManualEntry = useCallback(() => {
    setManualForm({
      title: searchQuery.trim() || ocrText.trim(),
      originalTitle: '',
      year: '',
      director: '',
      genres: '',
      cast: '',
      runtime: '',
      imdbId: '',
      description: '',
    })
    setError(null)
    setStep('manual')
  }, [searchQuery, ocrText])

  const confirmManualEntry = useCallback(() => {
    const title = manualForm.title.trim()
    if (!title) {
      setError(t('scan.manualTitleRequired'))
      return
    }

    const movie: WikidataMovie = {
      wikidataId: `manual:${Date.now()}`,
      title,
      originalTitle: manualForm.originalTitle.trim() || undefined,
      year: parseOptionalNumber(manualForm.year),
      director: manualForm.director.trim() || undefined,
      genres: parseCsv(manualForm.genres),
      cast: parseCsv(manualForm.cast),
      runtime: parseOptionalNumber(manualForm.runtime),
      imdbId: manualForm.imdbId.trim() || undefined,
      description: manualForm.description.trim() || undefined,
    }

    setSelectedMovie(movie)
    setError(null)
    setStep('confirm')
  }, [manualForm, t])

  // ── Speichern ───────────────────────────────────────────────────────
  const saveSelectedMovie = async () => {
    if (!selectedMovie) return
    setStep('saving')
    try {
      const isLocalCandidate = selectedMovie.wikidataId.startsWith('gemini:') || selectedMovie.wikidataId.startsWith('manual:')

      setStatus(t('scan.fetchWiki'))
      const wikiDetails = await getWikipediaDetails(selectedMovie.title, 'de')

      let posterUrl: string | undefined
      if (shouldSearchPoster(selectedMovie.coverUrl)) {
        setStatus(t('scan.searchPoster'))
        posterUrl = await searchMoviePoster(
          selectedMovie.title,
          selectedMovie.year,
          selectedMovie.originalTitle
        )
      }

      setStatus(t('scan.saving'))
      await saveStoredMovie(
        {
          title: selectedMovie.title,
          original_title: selectedMovie.originalTitle,
          year: selectedMovie.year,
          genres: selectedMovie.genres,
          cast_members: selectedMovie.cast,
          director: selectedMovie.director,
          description: selectedMovie.description || wikiDetails.description,
          cover_url: selectedMovie.coverUrl || posterUrl || undefined,
          wikidata_id: isLocalCandidate ? undefined : selectedMovie.wikidataId,
          imdb_id: selectedMovie.imdbId,
          runtime: selectedMovie.runtime,
        }
      )
      setStep('done')
    } catch (e) {
      setError(t('scan.saveError', { message: (e as Error).message }))
      setStep('confirm')
    } finally {
      setStatus('')
    }
  }

  const reset = () => {
    setCapturedUri(null)
    setOcrText('')
    setSearchQuery('')
    setOcrAlternatives([])
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('camera')
  }

  // ── Kamera-Schritt ──────────────────────────────────────────────────
  if (step === 'camera') {
    if (!permission?.granted) {
      return (
        <View style={styles.center}>
          <Text style={styles.text}>{t('scan.permissionRequired')}</Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>{t('scan.grantPermission')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={pickFromGallery}>
            <Text style={styles.btnText}>{t('scan.pickGallery')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={startManualTitleSearch}>
            <Text style={styles.btnText}>{t('scan.enterTitleManually')}</Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          {/* Rahmen-Hilfe */}
          <View style={styles.overlay}>
            <View style={styles.frame} />
            <Text style={styles.hint}>{t('scan.frameHint')}</Text>
          </View>
        </CameraView>
        <View style={styles.cameraControls}>
          <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
            <Text style={styles.galleryBtnText}>📁 {t('scan.galleryShort')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.captureBtn} onPress={takePicture} />
          <TouchableOpacity style={styles.galleryBtn} onPress={startManualTitleSearch}>
            <Text style={styles.galleryBtnText}>⌨️ {t('scan.titleShort')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Processing / Suche / Confirm / Done ────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Vorschaubild NUR wenn Wikidata-Cover vorhanden */}
      {selectedMovie?.coverUrl && step === 'confirm' && (
        <Image source={{ uri: selectedMovie.coverUrl }} style={styles.preview} resizeMode="contain" />
      )}

      {/* Status / Loader */}
      {status !== '' && (
        <View style={styles.statusRow}>
          <ActivityIndicator color="#6366f1" />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      )}

      {/* Fehler */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Suchfeld (ab Step 'search') */}
      {(step === 'search' || step === 'confirm') && (
        <View style={styles.searchSection}>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={backToCamera}
            disabled={!!status}
          >
            <Text style={styles.btnText}>{t('scan.backToCamera')}</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => doSearch(searchQuery)}
            placeholder={t('scan.movieTitlePlaceholder')}
            placeholderTextColor="#64748b"
            returnKeyType="search"
          />
          <TouchableOpacity
            style={styles.btn}
            onPress={() => doSearch(searchQuery)}
            disabled={!!status}
          >
            <Text style={styles.btnText}>🔍 {t('scan.searchButton')}</Text>
          </TouchableOpacity>

          <View style={styles.tmdbAttributionSearch}>
            <TmdbLogo width={104} height={20} />
            <Text style={styles.tmdbAttributionText}>{TMDB_ATTRIBUTION_NOTICE}</Text>
          </View>
        </View>
      )}

      {/* Suchergebnisse */}
      {step === 'search' && candidates.map((movie) => (
        <TouchableOpacity
          key={movie.wikidataId}
          style={styles.candidateCard}
          onPress={() => { setSelectedMovie(movie); setStep('confirm') }}
        >
          <View style={styles.candidateInfo}>
            <Text style={styles.candidateTitle}>{movie.title}</Text>
            <Text style={styles.candidateMeta}>
              {[movie.year, movie.director].filter(Boolean).join(' · ')}
            </Text>
            {movie.genres.length > 0 && (
              <Text style={styles.candidateGenres}>{movie.genres.slice(0, 3).join(', ')}</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}

      {step === 'search' && (
        <TouchableOpacity
          style={[styles.candidateCard, styles.manualCard]}
          onPress={openManualEntry}
        >
          <View style={styles.candidateInfo}>
            <Text style={styles.candidateTitle}>✍️ {t('scan.manualCardTitle')}</Text>
            <Text style={styles.candidateMeta}>{t('scan.manualCardSubtitle')}</Text>
          </View>
        </TouchableOpacity>
      )}

      {step === 'manual' && (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{t('scan.manualFormTitle')}</Text>

          <TextInput
            style={styles.input}
            value={manualForm.title}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, title: value }))}
            placeholder={t('scan.manualFieldTitle')}
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={styles.input}
            value={manualForm.originalTitle}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, originalTitle: value }))}
            placeholder={t('scan.manualFieldOriginalTitle')}
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={styles.input}
            value={manualForm.year}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, year: value }))}
            placeholder={t('scan.manualFieldYear')}
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            value={manualForm.director}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, director: value }))}
            placeholder={t('scan.manualFieldDirector')}
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={styles.input}
            value={manualForm.genres}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, genres: value }))}
            placeholder={t('scan.manualFieldGenres')}
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={styles.input}
            value={manualForm.cast}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, cast: value }))}
            placeholder={t('scan.manualFieldCast')}
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={styles.input}
            value={manualForm.runtime}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, runtime: value }))}
            placeholder={t('scan.manualFieldRuntime')}
            placeholderTextColor="#64748b"
            keyboardType="number-pad"
          />
          <TextInput
            style={styles.input}
            value={manualForm.imdbId}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, imdbId: value }))}
            placeholder={t('scan.manualFieldImdb')}
            placeholderTextColor="#64748b"
          />
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={manualForm.description}
            onChangeText={(value) => setManualForm((prev) => ({ ...prev, description: value }))}
            placeholder={t('scan.manualFieldDescription')}
            placeholderTextColor="#64748b"
            multiline
          />

          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={confirmManualEntry}>
            <Text style={styles.btnText}>✓ {t('scan.manualCreateCandidate')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setStep('search')}>
            <Text style={styles.btnText}>{t('scan.back')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bestätigungs-Schritt */}
      {step === 'confirm' && selectedMovie && (
        <View style={styles.confirmCard}>
          <TmdbLogo width={104} height={20} />
          <Text style={styles.confirmTitle}>{selectedMovie.title}</Text>
          {selectedMovie.year && <Text style={styles.confirmMeta}>{t('scan.confirmYear', { value: selectedMovie.year })}</Text>}
          {selectedMovie.director && <Text style={styles.confirmMeta}>{t('scan.confirmDirector', { value: selectedMovie.director })}</Text>}
          {selectedMovie.cast.length > 0 && (
            <Text style={styles.confirmMeta}>{t('scan.confirmCast', { value: selectedMovie.cast.slice(0, 3).join(', ') })}</Text>
          )}
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={saveSelectedMovie}>
            <Text style={styles.btnText}>✓ {t('scan.saveSelected')}</Text>
          </TouchableOpacity>
          <Text style={styles.tmdbAttributionText}>{TMDB_ATTRIBUTION_NOTICE}</Text>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setStep('search')}>
            <Text style={styles.btnText}>{t('scan.back')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Fertig */}
      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneText}>✅ {t('scan.saved')}</Text>
          <Text style={styles.doneSub}>{selectedMovie?.title}</Text>
          <TouchableOpacity style={styles.btn} onPress={reset}>
            <Text style={styles.btnText}>{t('scan.scanNext')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => router.replace(`/?refreshKey=${Date.now()}`)}
          >
            <Text style={styles.btnText}>{t('scan.toLibrary')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scrollContent: { padding: 16, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  camera: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  frame: {
    width: 280,
    height: 180,
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 8,
    opacity: 0.8,
  },
  hint: { color: '#fff', marginTop: 12, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 6 },
  cameraControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 24,
    backgroundColor: '#0f172a',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#6366f1',
    borderWidth: 4,
    borderColor: '#818cf8',
  },
  galleryBtn: { width: 72, alignItems: 'center' },
  galleryBtnText: { color: '#fff', fontSize: 12 },
  preview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#1e293b' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#1e293b', borderRadius: 8 },
  statusText: { color: '#94a3b8' },
  errorText: { color: '#f87171', padding: 12, backgroundColor: '#450a0a', borderRadius: 8 },
  searchSection: { gap: 8 },
  tmdbAttributionSearch: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  tmdbAttributionText: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  input: {
    backgroundColor: '#1e293b',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  btn: {
    backgroundColor: '#6366f1',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: '#334155' },
  btnGreen: { backgroundColor: '#16a34a' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  candidateCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  manualCard: {
    borderColor: '#6366f1',
    borderStyle: 'dashed',
  },
  candidateInfo: { gap: 3 },
  candidateTitle: { color: '#fff', fontWeight: '600', fontSize: 15 },
  candidateMeta: { color: '#94a3b8', fontSize: 13 },
  candidateGenres: { color: '#6366f1', fontSize: 12 },
  confirmCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  confirmTitle: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  confirmMeta: { color: '#94a3b8', fontSize: 13 },
  text: { color: '#94a3b8', marginBottom: 16, textAlign: 'center' },
  doneText: { fontSize: 24, marginBottom: 8 },
  doneSub: { color: '#fff', fontWeight: '600', fontSize: 16, marginBottom: 16, textAlign: 'center' },
})

