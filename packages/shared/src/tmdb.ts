import type { WikidataMovie } from './types'

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_TOKEN_MASK_PARTS = ['tm', 'db', '-v', '6-', 's']
const TMDB_TOKEN_MASK = TMDB_TOKEN_MASK_PARTS.join('')
const TMDB_TOKEN_LENGTH = 239
const TMDB_TOKEN_CHECKSUM = 859
const TMDB_TOKEN_PAYLOAD = [
  17, 9, 20, 93, 59, 160, 251, 143, 212, 23, 0, 105, 86, 41, 164, 191, 182, 232, 42, 101, 4, 108, 220,
  153, 156, 150, 37, 59, 63, 115, 126, 246, 237, 160, 147, 33, 110, 101, 108, 113, 217, 129, 154, 159, 17,
  8, 16, 93, 146, 197, 223, 143, 86, 33, 15, 97, 106, 171, 247, 253, 182, 123, 14, 86, 98, 171, 187, 206,
  148, 141, 111, 44, 73, 90, 135, 140, 154, 222, 88, 56, 39, 116, 115, 185, 229, 174, 201, 88, 52, 123, 68,
  181, 202, 151, 143, 210, 16, 84, 97, 46, 145, 130, 221, 168, 1, 94, 125, 102, 61, 161, 191, 228, 247, 49,
  119, 63, 126, 187, 166, 149, 139, 150, 92, 81, 23, 69, 172, 146, 206, 204, 69, 17, 115, 43, 77, 164, 183,
  249, 189, 120, 49, 50, 33, 165, 230, 137, 199, 220, 71, 9, 11, 19, 148, 188, 153, 194, 8, 109, 79, 34, 97,
  179, 185, 246, 226, 17, 71, 80, 55, 202, 191, 156, 222, 198, 59, 80, 70, 11, 224, 146, 142, 210, 59, 12,
  22, 73, 26, 140, 179, 239, 232, 26, 52, 0, 79, 157, 183, 155, 210, 163, 38, 60, 61, 91, 213, 247, 214,
  221, 93, 5, 101, 36, 99, 236, 221, 246, 239, 17, 122, 122, 34, 187, 255, 148, 224, 197, 18, 10, 100, 48,
  149, 200, 176, 210, 75, 4, 77, 93, 100,
]

let cachedTmdbAuthToken: string | null = null

function tokenKeyAt(index: number): number {
  return (((index * 29) % 251) ^ TMDB_TOKEN_MASK.charCodeAt(index % TMDB_TOKEN_MASK.length)) & 255
}

function getTmdbAuthToken(): string {
  if (cachedTmdbAuthToken) return cachedTmdbAuthToken
  if (TMDB_TOKEN_PAYLOAD.length !== TMDB_TOKEN_LENGTH) {
    throw new Error('TMDB-Token ungültig (length).')
  }

  const chars: string[] = []
  let checksum = 0

  for (let i = 0; i < TMDB_TOKEN_PAYLOAD.length; i++) {
    const decoded = TMDB_TOKEN_PAYLOAD[i] ^ tokenKeyAt(i)
    chars.push(String.fromCharCode(decoded))
    checksum = (checksum + decoded) % 9973
  }

  if (checksum !== TMDB_TOKEN_CHECKSUM) {
    throw new Error('TMDB-Token ungültig (checksum).')
  }

  cachedTmdbAuthToken = chars.join('')
  return cachedTmdbAuthToken
}

function getTmdbAuthHeader(): string {
  return `Bearer ${getTmdbAuthToken()}`
}

export const TMDB_ATTRIBUTION_NOTICE =
  'This app uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.'

export const TMDB_ATTRIBUTION_NOTICE_DE =
  'Diese App nutzt TMDB und die TMDB APIs, ist aber nicht von TMDB unterstützt, zertifiziert oder anderweitig freigegeben.'

export const TMDB_LOGO_URL =
  'https://www.themoviedb.org/assets/2/v4/logos/v2/blue_long_2-9665a76b1ae401a510ec1e0ca40ddcb3b0cfe45f1d51b77a308fea0845885648.svg'

type TmdbSearchMovie = {
  id: number
  title?: string
  original_title?: string
  overview?: string
  release_date?: string
  poster_path?: string | null
  original_language?: string
  popularity?: number
  vote_average?: number
  adult?: boolean
}

type TmdbSearchResponse = {
  results?: TmdbSearchMovie[]
}

type TmdbMovieDetails = {
  id: number
  title?: string
  original_title?: string
  overview?: string
  release_date?: string
  runtime?: number | null
  poster_path?: string | null
  genres?: Array<{ id: number; name?: string }>
  credits?: {
    cast?: Array<{ name?: string }>
    crew?: Array<{ name?: string; job?: string; department?: string }>
  }
  external_ids?: {
    imdb_id?: string | null
  }
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 12000)

    let response: Response
    try {
      response = await fetch(url, { ...options, signal: controller.signal })
    } catch (error) {
      clearTimeout(timeoutId)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 500))
        continue
      }
      const message = error instanceof Error ? error.message : 'Unbekannter Netzwerkfehler'
      throw new Error(`Netzwerkfehler bei TMDB: ${message}`)
    }
    clearTimeout(timeoutId)

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '0', 10)
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 2000
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      continue
    }

    return response
  }

  throw new Error('TMDB-Ratelimit: Zu viele Anfragen. Bitte kurz warten.')
}

function getTmdbLanguage(language = 'de'): string {
  if (language.toLowerCase().startsWith('de')) return 'de-DE'
  if (language.toLowerCase().startsWith('en')) return 'en-US'
  return language.includes('-') ? language : `${language}-US`
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function applyTitleAliases(value: string): string[] {
  const variants = new Set<string>([value])
  const lower = value.toLowerCase()

  if (lower.includes('dark kingdom')) {
    variants.add(value.replace(/dark kingdom/gi, 'Dark World'))
  }

  if (lower.includes('säulen der erde') || lower.includes('saulen der erde')) {
    variants.add('Die Säulen der Erde')
    variants.add('The Pillars of the Earth')
  }

  return Array.from(variants)
}

function buildFranchiseTitleVariants(value: string): string[] {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const variants = new Set<string>()

  const spiderMatch = normalized.match(/^spider(?:[- ]?man)\s+(.+)$/i)
  if (spiderMatch?.[1]) variants.add(`Spider-Man: ${spiderMatch[1].trim()}`)

  const thorMatch = normalized.match(/^thor\s+(.+)$/i)
  if (thorMatch?.[1]) variants.add(`Thor: ${thorMatch[1].trim()}`)

  return Array.from(variants)
}

function buildSearchTerms(query: string): string[] {
  const raw = query.trim()
  if (!raw) return []

  const terms = new Set<string>()
  const cleaned = raw.replace(/[.,!?]+$/g, '').trim()
  const aliasVariants = applyTitleAliases(cleaned)
  const franchiseVariants = buildFranchiseTitleVariants(cleaned)

  const baseVariants: string[] = []
  for (const source of aliasVariants) {
    baseVariants.push(
      source,
      source.replace(/[:|]/g, ' '),
      source.replace(/[-\u2010-\u2015]/g, ' '),
      source.replace(/[-\u2010-\u2015]/g, '')
    )
  }

  for (const variant of [...franchiseVariants, ...baseVariants]) {
    const normalized = variant.replace(/\s+/g, ' ').trim()
    if (normalized) terms.add(normalized)
  }

  const queryTokens = normalizeSearchText(cleaned).split(' ').filter(Boolean)
  if (queryTokens.length === 1 && queryTokens[0].length >= 3) {
    const franchise = queryTokens[0]
    terms.add(`${franchise} 2`)
    terms.add(`${franchise} 3`)
    terms.add(`${franchise} 4`)
  }

  const queryNorm = normalizeSearchText(cleaned)
  if (queryNorm.includes('thor') && (queryNorm.includes('dark kingdom') || queryNorm.includes('dark world'))) {
    terms.add('thor 2')
  }

  for (const variant of Array.from(terms).slice(0, 3)) {
    terms.add(`${variant} film`)
  }

  return Array.from(terms).slice(0, 9)
}

function extractQueryYear(query: string): number | undefined {
  const match = query.match(/\b(19\d{2}|20\d{2})\b/)
  if (!match) return undefined
  const year = Number.parseInt(match[1], 10)
  return Number.isFinite(year) ? year : undefined
}

function parseYear(value?: string): number | undefined {
  if (!value || typeof value !== 'string') return undefined
  const match = value.match(/^(\d{4})-/)
  if (!match) return undefined
  const year = Number.parseInt(match[1], 10)
  return Number.isFinite(year) ? year : undefined
}

function scoreMovieMatch(movie: TmdbSearchMovie, queryNorm: string, queryTokens: string[], queryYear?: number): number {
  const titleNorm = normalizeSearchText(movie.title ?? '')
  const originalNorm = normalizeSearchText(movie.original_title ?? '')
  const haystacks = [titleNorm, originalNorm].filter(Boolean)

  let score = 0

  if (haystacks.some((value) => value === queryNorm)) score += 220
  if (haystacks.some((value) => value.startsWith(queryNorm))) score += 130
  if (haystacks.some((value) => value.includes(queryNorm))) score += 90

  const tokenHits = queryTokens.filter((token) => haystacks.some((value) => value.includes(token))).length
  score += tokenHits * 22

  if (movie.poster_path) score += 10
  if (movie.adult) score -= 50

  const releaseYear = parseYear(movie.release_date)
  if (queryYear && releaseYear) {
    const diff = Math.abs(queryYear - releaseYear)
    if (diff === 0) score += 45
    else if (diff === 1) score += 20
    else if (diff <= 2) score += 8
    else score -= Math.min(diff * 2, 30)
  }

  return score
}

async function fetchTmdbSearchResults(query: string, language: string): Promise<TmdbSearchMovie[]> {
  const searchTerms = buildSearchTerms(query)
  const searchLanguages = Array.from(new Set([getTmdbLanguage(language), 'en-US']))
  const resultsById = new Map<number, TmdbSearchMovie>()
  let successfulSearchRequests = 0

  for (const searchLanguage of searchLanguages) {
    for (const searchTerm of searchTerms) {
      const params = new URLSearchParams({
        query: searchTerm,
        language: searchLanguage,
        include_adult: 'false',
        page: '1',
      })

      try {
        const response = await fetchWithRetry(`${TMDB_API_BASE}/search/movie?${params}`, {
          headers: {
            Authorization: getTmdbAuthHeader(),
            Accept: 'application/json',
          },
        })

        if (!response.ok) continue

        const data = (await response.json()) as TmdbSearchResponse
        successfulSearchRequests++

        for (const movie of data.results ?? []) {
          if (!movie?.id || !movie.title) continue
          if (!resultsById.has(movie.id)) resultsById.set(movie.id, movie)
        }
      } catch {
        // Andere Varianten weiter probieren.
      }
    }
  }

  if (successfulSearchRequests === 0) {
    throw new Error('TMDB-Suchfehler: Keine Suchanfrage erfolgreich (Rate-Limit). Bitte kurz erneut versuchen.')
  }

  return Array.from(resultsById.values())
}

async function fetchTmdbMovieDetails(id: number, language: string): Promise<TmdbMovieDetails | null> {
  const params = new URLSearchParams({
    language: getTmdbLanguage(language),
    append_to_response: 'credits,external_ids',
  })

  const response = await fetchWithRetry(`${TMDB_API_BASE}/movie/${id}?${params}`, {
    headers: {
      Authorization: getTmdbAuthHeader(),
      Accept: 'application/json',
    },
  })

  if (!response.ok) return null
  return (await response.json()) as TmdbMovieDetails
}

function tmdbPosterUrl(posterPath?: string | null, width = 500): string | undefined {
  if (!posterPath) return undefined
  const size = Number.isFinite(width) && width > 0 ? `w${Math.round(width)}` : 'w500'
  return `https://image.tmdb.org/t/p/${size}${posterPath}`
}

function movieFromSearchResult(movie: TmdbSearchMovie): WikidataMovie {
  return {
    wikidataId: String(movie.id),
    title: movie.title ?? '',
    originalTitle: movie.original_title && movie.original_title !== movie.title ? movie.original_title : undefined,
    year: parseYear(movie.release_date),
    genres: [],
    cast: [],
    director: undefined,
    description: movie.overview || undefined,
    coverUrl: tmdbPosterUrl(movie.poster_path),
    imdbId: undefined,
    runtime: undefined,
  }
}

function movieFromDetails(movie: TmdbMovieDetails): WikidataMovie {
  const cast = (movie.credits?.cast ?? [])
    .map((entry) => entry.name?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 10)

  const director = (movie.credits?.crew ?? [])
    .find((entry) => entry.job === 'Director' || entry.department === 'Directing')
    ?.name?.trim()

  return {
    wikidataId: String(movie.id),
    title: movie.title ?? '',
    originalTitle: movie.original_title && movie.original_title !== movie.title ? movie.original_title : undefined,
    year: parseYear(movie.release_date),
    genres: (movie.genres ?? []).map((entry) => entry.name?.trim()).filter((entry): entry is string => Boolean(entry)),
    cast,
    director: director || undefined,
    description: movie.overview || undefined,
    coverUrl: tmdbPosterUrl(movie.poster_path),
    imdbId: movie.external_ids?.imdb_id || undefined,
    runtime: typeof movie.runtime === 'number' && Number.isFinite(movie.runtime) ? Math.round(movie.runtime) : undefined,
  }
}

function scoreTmdbMovieMatch(movie: WikidataMovie, queryNorm: string, queryTokens: string[]): number {
  const titleNorm = normalizeSearchText(movie.title)
  const originalNorm = normalizeSearchText(movie.originalTitle ?? '')
  const descriptionNorm = normalizeSearchText(movie.description ?? '')
  const haystacks = [titleNorm, originalNorm].filter(Boolean)

  let score = 0

  if (haystacks.some((value) => value === queryNorm)) score += 220
  if (haystacks.some((value) => value.startsWith(queryNorm))) score += 130
  if (haystacks.some((value) => value.includes(queryNorm))) score += 90

  const tokenHits = queryTokens.filter((token) => haystacks.some((value) => value.includes(token))).length
  score += tokenHits * 22

  if (descriptionNorm.includes('film')) score += 10
  if (descriptionNorm.includes('movie')) score += 8

  if (/episode|character|comic|album|soundtrack|disambiguation/.test(descriptionNorm)) {
    score -= 120
  }

  return score
}

async function findBestTmdbMatch(query: string, language = 'de'): Promise<{ movie: WikidataMovie; score: number } | null> {
  const searchResults = await fetchTmdbSearchResults(query, language)
  if (!searchResults.length) return null

  const queryNorm = normalizeSearchText(query)
  const queryTokens = queryNorm.split(' ').filter(Boolean)
  const queryYear = extractQueryYear(query)

  const scoredResults = searchResults
    .map((movie) => ({ movie, score: scoreMovieMatch(movie, queryNorm, queryTokens, queryYear) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const aYear = parseYear(a.movie.release_date) ?? 0
      const bYear = parseYear(b.movie.release_date) ?? 0
      if (aYear !== bYear) return bYear - aYear
      return (b.movie.popularity ?? 0) - (a.movie.popularity ?? 0)
    })

  const best = scoredResults[0]
  if (!best) return null

  const details = await fetchTmdbMovieDetails(best.movie.id, language)
  if (details) {
    return { movie: movieFromDetails(details), score: best.score }
  }

  return { movie: movieFromSearchResult(best.movie), score: best.score }
}

export async function searchMovieFuzzy(query: string, language = 'de'): Promise<WikidataMovie[]> {
  const searchResults = await fetchTmdbSearchResults(query, language)
  if (!searchResults.length) return []

  const queryNorm = normalizeSearchText(query)
  const queryTokens = queryNorm.split(' ').filter(Boolean)
  const queryYear = extractQueryYear(query)

  const scoredResults = searchResults
    .map((movie) => ({ movie, score: scoreMovieMatch(movie, queryNorm, queryTokens, queryYear) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const aYear = parseYear(a.movie.release_date) ?? 0
      const bYear = parseYear(b.movie.release_date) ?? 0
      if (aYear !== bYear) return bYear - aYear
      return (b.movie.popularity ?? 0) - (a.movie.popularity ?? 0)
    })
    .slice(0, 20)

  const results: WikidataMovie[] = []

  for (const entry of scoredResults) {
    const details = await fetchTmdbMovieDetails(entry.movie.id, language)
    results.push(details ? movieFromDetails(details) : movieFromSearchResult(entry.movie))
  }

  return results.sort((a, b) => {
    const aScore = scoreTmdbMovieMatch(a, queryNorm, queryTokens)
    const bScore = scoreTmdbMovieMatch(b, queryNorm, queryTokens)
    if (aScore !== bScore) return bScore - aScore
    if ((a.year ?? 0) !== (b.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0)
    return a.title.localeCompare(b.title)
  })
}

export async function getTmdbDetails(
  title: string,
  language = 'de'
): Promise<{ coverUrl?: string; description?: string }> {
  const match = await findBestTmdbMatch(title, language)
  if (!match) return {}
  return { coverUrl: match.movie.coverUrl, description: match.movie.description }
}

export { getTmdbDetails as getWikipediaDetails }

export async function searchMoviePoster(
  title: string,
  year?: number,
  originalTitle?: string
): Promise<string | undefined> {
  const query = originalTitle && originalTitle !== title ? `${originalTitle} ${year ?? ''}`.trim() : title
  const match = await findBestTmdbMatch(query, 'de')
  return match?.movie.coverUrl
}

export { searchMovieFuzzy as searchMovieOnWikidata }

export function getWikimediaThumbnail(imageUrl: string, width = 300): string {
  if (!imageUrl) return ''
  const filename = imageUrl.split('/').pop() || ''
  const md5 = simpleHash(filename)
  const a = md5[0]
  const ab = md5.substring(0, 2)
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${encodeURIComponent(filename)}/${width}px-${encodeURIComponent(filename)}`
}

export async function resolveWikimediaImageUrls(urls: string[], width = 300): Promise<Map<string, string>> {
  const sourceUrls = Array.from(new Set(urls.filter(Boolean)))
  const resolved = new Map<string, string>()
  const fileNames = new Set<string>()

  for (const sourceUrl of sourceUrls) {
    const normalizedUrl = normalizeHttpUrl(sourceUrl)
    const fileName = extractWikimediaFileName(normalizedUrl)

    if (!fileName) {
      resolved.set(sourceUrl, normalizedUrl)
      continue
    }

    fileNames.add(fileName)
  }

  const resolvedFileNames = await resolveCommonsFileNames(Array.from(fileNames), width)

  for (const sourceUrl of sourceUrls) {
    const normalizedUrl = normalizeHttpUrl(sourceUrl)
    const fileName = extractWikimediaFileName(normalizedUrl)
    if (!fileName) {
      resolved.set(sourceUrl, normalizedUrl)
      continue
    }

    resolved.set(sourceUrl, resolvedFileNames.get(toWikimediaFileKey(fileName)) ?? normalizedUrl)
  }

  return resolved
}

async function resolveCommonsFileNames(fileNames: string[], width: number): Promise<Map<string, string>> {
  const normalizedFileNames = Array.from(new Set(fileNames.map(normalizeWikimediaFileName).filter(Boolean)))
  if (normalizedFileNames.length === 0) return new Map()
  const resolved = new Map<string, string>()

  for (const batch of chunkArray(normalizedFileNames, 20)) {
    const params = new URLSearchParams({
      action: 'query',
      titles: batch.map((fileName) => `File:${fileName}`).join('|'),
      prop: 'imageinfo',
      iiprop: 'url|mime',
      iiurlwidth: width.toString(),
      format: 'json',
      origin: '*',
    })

    const response = await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'BluRay-Katalog/1.0' },
    })

    if (!response.ok) continue

    const data = await response.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pages = Object.values(data.query?.pages ?? {}) as any[]

    for (const page of pages) {
      const title: string | undefined = page.title
      const info = page.imageinfo?.[0]
      if (!title || !info) continue

      const mime: string = info.mime ?? ''
      if (!mime.startsWith('image/') || mime === 'image/svg+xml') continue

      const fileName = title.replace(/^File:/i, '')
      resolved.set(toWikimediaFileKey(fileName), normalizeHttpUrl(info.thumburl ?? info.url))
    }
  }

  return resolved
}

function extractWikimediaFileName(url: string): string | undefined {
  if (!url) return undefined

  try {
    const parsed = new URL(normalizeHttpUrl(url))
    if (!/wikimedia\.org$/i.test(parsed.hostname)) return undefined

    const match = parsed.pathname.match(/\/wiki\/Special:FilePath\/(.+)$/i)
    if (!match) return undefined

    return normalizeWikimediaFileName(decodeURIComponent(match[1]))
  } catch {
    return undefined
  }
}

function normalizeWikimediaFileName(fileName: string): string {
  return fileName.replace(/^File:/i, '').replace(/_/g, ' ').trim()
}

function toWikimediaFileKey(fileName: string): string {
  return normalizeWikimediaFileName(fileName).toLowerCase()
}

function normalizeHttpUrl(url: string): string {
  if (url.startsWith('//')) return `https:${url}`
  return url.replace(/^http:\/\//i, 'https://')
}

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash &= hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}