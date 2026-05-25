import type { WikidataMovie } from './types'

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
const WIKIPEDIA_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary'

/** Fetch mit automatischem Retry bei 429 (Rate Limit). */
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options)
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '0')
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 2000
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    return res
  }
  throw new Error('Wikidata-Ratelimit: Zu viele Anfragen. Bitte kurz warten.')
}
/**
 * Sucht nach Filmen in Wikidata per SPARQL ohne API-Key.
 * Gibt detaillierte Filminformationen zurück.
 */
export async function searchMovieOnWikidata(title: string, language = 'de'): Promise<WikidataMovie[]> {
  const langFallback = language === 'de' ? 'de,en' : 'en,de'

  // SPARQL-Abfrage für Filme nach Titel
  const sparql = `
SELECT DISTINCT ?movie ?movieLabel ?originalTitleLabel ?year ?genreLabel ?actorLabel ?directorLabel ?imdb ?runtime ?image WHERE {
  VALUES ?filmTypes { wd:Q11424 wd:Q93204 wd:Q506240 }
  ?movie wdt:P31 ?filmTypes.
  ?movie rdfs:label ?titleMatch.
  FILTER(LCASE(STR(?titleMatch)) = LCASE("${title.replace(/"/g, '\\"')}"))
  
  OPTIONAL { ?movie wdt:P577 ?releaseDate. BIND(YEAR(?releaseDate) AS ?year) }
  OPTIONAL { ?movie wdt:P136 ?genre. }
  OPTIONAL { ?movie wdt:P161 ?actor. }
  OPTIONAL { ?movie wdt:P57 ?director. }
  OPTIONAL { ?movie wdt:P345 ?imdb. }
  OPTIONAL { ?movie wdt:P2047 ?runtime. }
  OPTIONAL { ?movie wdt:P18 ?image. }
  OPTIONAL { ?movie wdt:P1476 ?originalTitle. }
  
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "${langFallback}".
    ?movie rdfs:label ?movieLabel.
    ?genre rdfs:label ?genreLabel.
    ?actor rdfs:label ?actorLabel.
    ?director rdfs:label ?directorLabel.
    ?originalTitle rdfs:label ?originalTitleLabel.
  }
} LIMIT 30`

  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(sparql)}&format=json`

  const response = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'BluRay-Katalog/1.0' },
  })

  if (!response.ok) throw new Error(`Wikidata-Fehler: ${response.status}`)

  const json = await response.json()
  return parseWikidataResults(json.results.bindings)
}

/**
 * Sucht Filme per Wikidata Search API + wbgetentities (schnell, kein SPARQL-Timeout).
 */
export async function searchMovieFuzzy(query: string, language = 'de'): Promise<WikidataMovie[]> {
  const langCode = language === 'de' ? 'de' : 'en'

  // ── Schritt 1: Schnellsuche nach Entitäten ─────────────────────────
  const searchParams = new URLSearchParams({
    action: 'wbsearchentities',
    search: query,
    language: langCode,
    type: 'item',
    format: 'json',
    limit: '20',
    uselang: langCode,
    origin: '*',
  })
  const searchRes = await fetchWithRetry(`https://www.wikidata.org/w/api.php?${searchParams}`, {
    headers: { 'User-Agent': 'BluRay-Katalog/1.0' },
  })
  if (!searchRes.ok) throw new Error(`Wikidata-Suchfehler: ${searchRes.status}`)
  const searchData = await searchRes.json()
  const items: Array<{ id: string; label: string; description?: string }> = searchData.search || []
  if (items.length === 0) return []

  // ── Schritt 2: Entitäten-Details per wbgetentities ─────────────────
  const ids = items.map((i) => i.id).join('|')
  const entityParams = new URLSearchParams({
    action: 'wbgetentities',
    ids,
    props: 'labels|claims|descriptions',
    languages: `${langCode}|en`,
    format: 'json',
    origin: '*',
  })
  const entityRes = await fetchWithRetry(`https://www.wikidata.org/w/api.php?${entityParams}`, {
    headers: { 'User-Agent': 'BluRay-Katalog/1.0' },
  })
  if (!entityRes.ok) throw new Error(`Wikidata-Detailfehler: ${entityRes.status}`)
  const entityData = await entityRes.json()

  // Film-QIDs: Spielfilm, Animationsfilm, Dokumentarfilm, Kurzfilm, …
  const filmTypeQids = new Set([
    'Q11424', 'Q93204', 'Q506240', 'Q202866', 'Q1361932', 'Q24862', 'Q29168811',
  ])

  const imageFiles = new Set<string>()
  for (const item of items) {
    const entity = entityData.entities?.[item.id]
    const imageFile: string | undefined = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    if (imageFile) imageFiles.add(imageFile)
  }

  const resolvedImageUrls = await resolveCommonsFileNames(Array.from(imageFiles), 300)

  const results: WikidataMovie[] = []

  for (const item of items) {
    const entity = entityData.entities?.[item.id]
    if (!entity || entity.missing) continue

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claims: Record<string, any[]> = entity.claims || {}

    // Nur Einträge vom Typ "Film" (P31)
    const instanceOf: string[] = (claims.P31 || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)
    if (instanceOf.length > 0 && !instanceOf.some((id) => filmTypeQids.has(id))) continue

    // Erscheinungsjahr (P577)
    const releaseTime: string | undefined = claims.P577?.[0]?.mainsnak?.datavalue?.value?.time
    const year = releaseTime ? parseInt(releaseTime.substring(1, 5)) : undefined

    // IMDb-ID (P345)
    const imdbId: string | undefined = claims.P345?.[0]?.mainsnak?.datavalue?.value

    // Laufzeit in Minuten (P2047)
    const runtimeRaw: string | undefined = claims.P2047?.[0]?.mainsnak?.datavalue?.value?.amount
    const runtime = runtimeRaw ? Math.round(parseFloat(runtimeRaw)) : undefined

    // Cover-Bild (P18 → Wikimedia Commons)
    const imageFile: string | undefined = claims.P18?.[0]?.mainsnak?.datavalue?.value
    const coverUrl = imageFile
      ? resolvedImageUrls.get(toWikimediaFileKey(imageFile))
        ?? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFile.replace(/ /g, '_'))}?width=300`
      : undefined

    const title = entity.labels?.[langCode]?.value || entity.labels?.en?.value || item.label
    const enTitle = entity.labels?.en?.value
    const originalTitle = enTitle && enTitle !== title ? enTitle : undefined
    const description =
      entity.descriptions?.[langCode]?.value || entity.descriptions?.en?.value

    results.push({
      wikidataId: item.id,
      title,
      originalTitle,
      year,
      genres: [],
      cast: [],
      imdbId,
      runtime,
      coverUrl,
      description,
    })
  }

  return results
}

/**
 * Sucht das offizielle Film-Poster über Wikipedia:
 * 1. OpenSearch → exakter Seitentitel
 * 2. prop=images → alle Bilder auf der Seite
 * 3. Filter nach "poster" im Dateinamen → imageinfo → URL
 */
export async function searchMoviePoster(title: string, year?: number, originalTitle?: string): Promise<string | undefined> {
  const BASE = 'https://en.wikipedia.org/w/api.php'
  const UA = { 'User-Agent': 'BluRay-Katalog/1.0' }

  // Englischen Originaltitel zuerst, dann lokalisierten Titel
  const titlesToTry = [...new Set([originalTitle, title].filter(Boolean) as string[])]

  for (const searchTitle of titlesToTry) {
    // Mehrere Suchabfragen versuchen: mit Jahr, ohne Jahr, nur Titel
    const queries = year
      ? [`${searchTitle} ${year} film`, `${searchTitle} film`, searchTitle]
      : [`${searchTitle} film`, searchTitle]

    for (const searchTerm of queries) {
      try {
        const result = await _searchPosterWithTerm(searchTerm, BASE, UA)
        if (result) return result
      } catch {
        // nächste Variante versuchen
      }
    }
  }
  return undefined
}

async function _searchPosterWithTerm(
  searchTerm: string,
  BASE: string,
  UA: Record<string, string>
): Promise<string | undefined> {
  // ── Schritt 1: exakten Wikipedia-Seitentitel finden ───────────────
  const s1 = new URLSearchParams({ action: 'opensearch', search: searchTerm, limit: '5', namespace: '0', format: 'json', origin: '*' })
  const r1 = await fetch(`${BASE}?${s1}`, { headers: UA })
  if (!r1.ok) return undefined
  const [, titles] = (await r1.json()) as [string, string[]]
  if (!titles.length) return undefined

  // ── Schritt 2: alle Bilder auf der Seite auflisten ────────────────
  const pageTitle = titles[0]
  const s2 = new URLSearchParams({ action: 'query', titles: pageTitle, prop: 'images', imlimit: '30', format: 'json', origin: '*' })
  const r2 = await fetch(`${BASE}?${s2}`, { headers: UA })
  if (!r2.ok) return undefined
  const d2 = await r2.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page0 = Object.values(d2.query?.pages ?? {})[0] as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allImages: string[] = (page0?.images ?? []).map((img: any) => img.title as string)

  // ── Schritt 3: nach "poster" filtern, sonst erstes JPG/PNG ────────
  const isImage = (n: string) => /\.(jpe?g|png)$/i.test(n)
  const isExcluded = (n: string) => /icon|logo|flag|signature|map|photo|cast|crew/i.test(n)
  const posterFiles = allImages.filter(n => /poster/i.test(n) && isImage(n) && !isExcluded(n))
  const fallbackFiles = allImages.filter(n => isImage(n) && !isExcluded(n))
  const candidates = (posterFiles.length ? posterFiles : fallbackFiles).slice(0, 3)
  if (!candidates.length) return undefined

  // ── Schritt 4: Bild-URL per imageinfo holen ───────────────────────
  const s3 = new URLSearchParams({ action: 'query', titles: candidates.join('|'), prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '500', format: 'json', origin: '*' })
  const r3 = await fetch(`${BASE}?${s3}`, { headers: UA })
  if (!r3.ok) return undefined
  const d3 = await r3.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const infoPages = Object.values(d3.query?.pages ?? {}) as any[]
  for (const p of infoPages) {
    const info = p.imageinfo?.[0]
    if (!info) continue
    const mime: string = info.mime ?? ''
    if (!mime.startsWith('image/') || mime === 'image/svg+xml') continue
    return info.thumburl ?? info.url
  }
  return undefined
}

/**
 * Holt das Cover-Bild und die Beschreibung von Wikipedia (kein API-Key nötig).
 */
export async function getWikipediaDetails(
  title: string,
  language = 'de'
): Promise<{ coverUrl?: string; description?: string }> {
  try {
    const wikiBase = `https://${language}.wikipedia.org/api/rest_v1/page/summary`
    const response = await fetch(`${wikiBase}/${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': 'BluRay-Katalog/1.0' },
    })

    if (!response.ok) {
      // Fallback auf Englisch
      const enResponse = await fetch(`${WIKIPEDIA_REST}/${encodeURIComponent(title)}`, {
        headers: { 'User-Agent': 'BluRay-Katalog/1.0' },
      })
      if (!enResponse.ok) return {}
      const enData = await enResponse.json()
      return {
        coverUrl: enData.thumbnail?.source || enData.originalimage?.source,
        description: enData.extract,
      }
    }

    const data = await response.json()
    return {
      coverUrl: data.thumbnail?.source || data.originalimage?.source,
      description: data.extract,
    }
  } catch {
    return {}
  }
}

function parseWikidataResults(bindings: Record<string, { value: string }>[]): WikidataMovie[] {
  const moviesMap = new Map<string, WikidataMovie>()

  for (const row of bindings) {
    const movieId = row.movie?.value?.split('/').pop() || ''
    if (!movieId) continue

    if (!moviesMap.has(movieId)) {
      moviesMap.set(movieId, {
        wikidataId: movieId,
        title: row.movieLabel?.value || '',
        originalTitle: row.originalTitleLabel?.value,
        year: row.year?.value ? parseInt(row.year.value) : undefined,
        genres: [],
        cast: [],
        director: row.directorLabel?.value,
        imdbId: row.imdb?.value,
        runtime: row.runtime?.value ? parseInt(row.runtime.value) : undefined,
        coverUrl: row.image?.value
          ? row.image.value.replace('http://', 'https://')
          : undefined,
      })
    }

    const movie = moviesMap.get(movieId)!

    if (row.genreLabel?.value && !movie.genres.includes(row.genreLabel.value)) {
      movie.genres.push(row.genreLabel.value)
    }

    if (row.actorLabel?.value && !movie.cast.includes(row.actorLabel.value)) {
      if (movie.cast.length < 10) {
        movie.cast.push(row.actorLabel.value)
      }
    }

    if (row.directorLabel?.value && !movie.director) {
      movie.director = row.directorLabel.value
    }
  }

  return Array.from(moviesMap.values()).filter((m) => m.title)
}

/**
 * Wikimedia-Bild-URL in eine HTTPS-URL mit gewünschter Breite umwandeln
 */
export function getWikimediaThumbnail(imageUrl: string, width = 300): string {
  if (!imageUrl) return ''
  // Wikimedia Commons Thumbnail-URL generieren
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

  const params = new URLSearchParams({
    action: 'query',
    titles: normalizedFileNames.map((fileName) => `File:${fileName}`).join('|'),
    prop: 'imageinfo',
    iiprop: 'url|mime',
    iiurlwidth: width.toString(),
    format: 'json',
    origin: '*',
  })

  const response = await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'BluRay-Katalog/1.0' },
  })

  if (!response.ok) return new Map()

  const data = await response.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages = Object.values(data.query?.pages ?? {}) as any[]
  const resolved = new Map<string, string>()

  for (const page of pages) {
    const title: string | undefined = page.title
    const info = page.imageinfo?.[0]
    if (!title || !info) continue

    const mime: string = info.mime ?? ''
    if (!mime.startsWith('image/') || mime === 'image/svg+xml') continue

    const fileName = title.replace(/^File:/i, '')
    resolved.set(toWikimediaFileKey(fileName), normalizeHttpUrl(info.thumburl ?? info.url))
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
  // MD5-ähnlicher einfacher Hash für Wikimedia-Pfade
  // In Produktion: crypto.createHash('md5').update(str).digest('hex')
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  const h = Math.abs(hash).toString(16).padStart(8, '0')
  return h
}
