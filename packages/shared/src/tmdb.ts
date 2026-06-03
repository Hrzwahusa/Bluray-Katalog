import type { TmdbMovie } from './types'

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

// ── Typen ────────────────────────────────────────────────────────────────────

type TmdbSearchMovie = {
  id: number
  title?: string
  original_title?: string
  overview?: string
  release_date?: string
  poster_path?: string | null
  popularity?: number
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

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

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

function parseYear(value?: string): number | undefined {
  if (!value) return undefined
  const match = value.match(/^(\d{4})-/)
  if (!match) return undefined
  const year = Number.parseInt(match[1], 10)
  return Number.isFinite(year) ? year : undefined
}

function tmdbPosterUrl(posterPath?: string | null, width = 500): string | undefined {
  if (!posterPath) return undefined
  const size = Number.isFinite(width) && width > 0 ? `w${Math.round(width)}` : 'w500'
  return `https://image.tmdb.org/t/p/${size}${posterPath}`
}

function movieFromSearchResult(movie: TmdbSearchMovie): TmdbMovie {
  const id = String(movie.id)
  return {
    tmdbId: id,
    title: movie.title ?? '',
    originalTitle: movie.original_title && movie.original_title !== movie.title
      ? movie.original_title
      : undefined,
    year: parseYear(movie.release_date),
    genres: [],
    cast: [],
    description: movie.overview || undefined,
    coverUrl: tmdbPosterUrl(movie.poster_path),
  }
}

function movieFromDetails(movie: TmdbMovieDetails): TmdbMovie {
  const id = String(movie.id)
  const cast = (movie.credits?.cast ?? [])
    .map((entry) => entry.name?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 10)

  const director = (movie.credits?.crew ?? [])
    .find((entry) => entry.job === 'Director' || entry.department === 'Directing')
    ?.name?.trim()

  return {
    tmdbId: id,
    title: movie.title ?? '',
    originalTitle: movie.original_title && movie.original_title !== movie.title
      ? movie.original_title
      : undefined,
    year: parseYear(movie.release_date),
    genres: (movie.genres ?? [])
      .map((entry) => entry.name?.trim())
      .filter((entry): entry is string => Boolean(entry)),
    cast,
    director: director || undefined,
    description: movie.overview || undefined,
    coverUrl: tmdbPosterUrl(movie.poster_path),
    imdbId: movie.external_ids?.imdb_id || undefined,
    runtime: typeof movie.runtime === 'number' && Number.isFinite(movie.runtime)
      ? Math.round(movie.runtime)
      : undefined,
  }
}

// ── Öffentliche API ───────────────────────────────────────────────────────────

/**
 * Sucht Filme auf TMDB anhand eines Titels.
 * Gibt eine Liste von Treffern zurück (ohne Detail-Requests).
 * Der User wählt danach manuell den richtigen Film aus.
 */
export async function searchMovieFuzzy(query: string, language = 'de'): Promise<TmdbMovie[]> {
  const params = new URLSearchParams({
    query: query.trim(),
    language: getTmdbLanguage(language),
    include_adult: 'false',
    page: '1',
  })

  const response = await fetchWithRetry(`${TMDB_API_BASE}/search/movie?${params}`, {
    headers: {
      Authorization: getTmdbAuthHeader(),
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('TMDB-Ratelimit: Zu viele Anfragen. Bitte kurz warten.')
    }
    throw new Error(`TMDB-Suchfehler: ${response.status}`)
  }

  const data = (await response.json()) as TmdbSearchResponse

  return (data.results ?? [])
    .filter((movie) => movie?.id && movie.title && !movie.adult)
    .map(movieFromSearchResult)
}

/**
 * Holt vollständige Details (Cast, Crew, Genres, IMDb-ID) für einen
 * bereits ausgewählten Film. Wird erst nach der manuellen Auswahl aufgerufen.
 */
export async function getMovieDetails(tmdbId: string, language = 'de'): Promise<TmdbMovie | null> {
  const params = new URLSearchParams({
    language: getTmdbLanguage(language),
    append_to_response: 'credits,external_ids',
  })

  const response = await fetchWithRetry(`${TMDB_API_BASE}/movie/${tmdbId}?${params}`, {
    headers: {
      Authorization: getTmdbAuthHeader(),
      Accept: 'application/json',
    },
  })

  if (!response.ok) return null

  const data = (await response.json()) as TmdbMovieDetails
  return movieFromDetails(data)
}

export async function searchMoviePoster(
  title: string,
  year?: number,
  originalTitle?: string,
): Promise<string | undefined> {
  const query = (originalTitle && originalTitle !== title
    ? `${originalTitle} ${year ?? ''}`.trim()
    : title)
  const results = await searchMovieFuzzy(query)
  return results[0]?.coverUrl
}

export async function getTmdbDetails(
  title: string,
  language = 'de',
): Promise<{ coverUrl?: string; description?: string }> {
  const results = await searchMovieFuzzy(title, language)
  const best = results[0]
  if (!best) return {}
  return { coverUrl: best.coverUrl, description: best.description }
}

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
