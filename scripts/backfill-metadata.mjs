#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const FILM_TYPE_QIDS = new Set([
  'Q11424',
  'Q93204',
  'Q506240',
  'Q202866',
  'Q1361932',
  'Q24862',
  'Q29168811',
])

function parseArgs(argv) {
  const args = {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '',
    language: process.env.WIKIDATA_LANG || 'de',
    delayMs: Number.parseInt(process.env.BACKFILL_DELAY_MS || '1800', 10),
    max: Number.parseInt(process.env.BACKFILL_MAX || '0', 10),
    force: false,
    dryRun: false,
  }

  for (let i = 2; i < argv.length; i++) {
    const current = argv[i]
    const next = argv[i + 1]

    if (current === '--url' && next) {
      args.url = next
      i++
      continue
    }
    if (current === '--key' && next) {
      args.key = next
      i++
      continue
    }
    if (current === '--language' && next) {
      args.language = next
      i++
      continue
    }
    if (current === '--delay-ms' && next) {
      args.delayMs = Number.parseInt(next, 10)
      i++
      continue
    }
    if (current === '--max' && next) {
      args.max = Number.parseInt(next, 10)
      i++
      continue
    }
    if (current === '--force') {
      args.force = true
      continue
    }
    if (current === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (current === '--help' || current === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return args
}

function printHelp() {
  console.log('Backfill von erweiterten Filmdaten aus Wikidata in Supabase.')
  console.log('')
  console.log('Nutzung:')
  console.log('  npm run metadata:backfill -- --url <SUPABASE_URL> --key <SUPABASE_KEY> [Optionen]')
  console.log('')
  console.log('Optionen:')
  console.log('  --language <de|en>   Wikidata-Sprache (Standard: de)')
  console.log('  --delay-ms <zahl>    Pause zwischen Filmen in ms (Standard: 1800)')
  console.log('  --max <zahl>         Maximal zu bearbeitende Filme (0 = alle)')
  console.log('  --force              Auch Filme mit bereits vorhandenen Metadaten aktualisieren')
  console.log('  --dry-run            Keine DB-Updates schreiben, nur anzeigen')
  console.log('')
  console.log('Alternativ ueber Umgebungsvariablen: SUPABASE_URL, SUPABASE_KEY')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options = {}, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'BluRay-Katalog-MetadataBackfill/1.0',
        ...(options.headers || {}),
      },
    })

    if (response.status !== 429 && response.status < 500) {
      return response
    }

    if (attempt === retries) {
      return response
    }

    const retryAfterHeader = response.headers.get('retry-after')
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 0
    const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : (attempt + 1) * 2000

    console.log(`  -> Rate limit/server busy (${response.status}), warte ${waitMs}ms...`)
    await sleep(waitMs)
  }

  throw new Error('Unreachable retry state')
}

function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getEntityIdFromSnak(claim) {
  return claim?.mainsnak?.datavalue?.value?.id
}

function extractEntityIdsFromClaims(claims, prop, max = 10) {
  const values = (claims?.[prop] || [])
    .map((claim) => getEntityIdFromSnak(claim))
    .filter(Boolean)
  return Array.from(new Set(values)).slice(0, max)
}

function isLikelyFilmEntity(entity, language, searchLabelFallback = '') {
  const claims = entity?.claims || {}
  const instanceOf = extractEntityIdsFromClaims(claims, 'P31', 10)
  if (instanceOf.some((id) => FILM_TYPE_QIDS.has(id))) {
    return true
  }

  const description =
    entity?.descriptions?.[language]?.value ||
    entity?.descriptions?.en?.value ||
    searchLabelFallback ||
    ''

  const d = normalizeText(description)
  return d.includes('film') || d.includes('movie')
}

async function wikidataSearchIds(title, language) {
  const ids = new Set()
  const terms = new Set([
    title.trim(),
    title.replace(/\(.*?\)/g, '').trim(),
  ])
  const langs = Array.from(new Set([language, 'en']))

  for (const lang of langs) {
    for (const term of terms) {
      if (!term) continue

      const searchParams = new URLSearchParams({
        action: 'wbsearchentities',
        search: term,
        language: lang,
        type: 'item',
        format: 'json',
        limit: '20',
        uselang: lang,
        origin: '*',
      })

      const res = await fetchWithRetry(`https://www.wikidata.org/w/api.php?${searchParams}`)
      if (!res.ok) continue

      const data = await res.json()
      const foundItems = data.search || []
      for (const item of foundItems) {
        if (item?.id) ids.add(item.id)
      }
    }
  }

  return Array.from(ids)
}

async function wikidataGetEntities(ids, language) {
  if (!ids.length) return {}

  const entities = {}
  const chunkSize = 50
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize)
    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'labels|descriptions|claims',
      languages: `${language}|en`,
      format: 'json',
      origin: '*',
    })

    const res = await fetchWithRetry(`https://www.wikidata.org/w/api.php?${params}`)
    if (!res.ok) {
      throw new Error(`Wikidata details failed: ${res.status}`)
    }

    const data = await res.json()
    Object.assign(entities, data.entities || {})
  }

  return entities
}

async function fetchEntityLabels(ids, language) {
  if (!ids.length) return new Map()
  const entities = await wikidataGetEntities(ids, language)
  const labels = new Map()

  for (const [id, entity] of Object.entries(entities)) {
    const label = entity?.labels?.[language]?.value || entity?.labels?.en?.value
    if (label) labels.set(id, label)
  }

  return labels
}

function extractYear(entity) {
  const releaseTime = entity?.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time
  if (!releaseTime || typeof releaseTime !== 'string' || releaseTime.length < 5) return undefined
  const parsed = Number.parseInt(releaseTime.substring(1, 5), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function titleFromEntity(entity, language, fallback = '') {
  return entity?.labels?.[language]?.value || entity?.labels?.en?.value || fallback
}

function scoreCandidate(movie, entity, language) {
  const movieTitle = normalizeText(movie.title)
  const candidateTitle = normalizeText(titleFromEntity(entity, language, ''))

  let score = 0
  if (movieTitle && candidateTitle) {
    if (movieTitle === candidateTitle) score += 120
    if (candidateTitle.includes(movieTitle) || movieTitle.includes(candidateTitle)) score += 70

    const movieTokens = new Set(movieTitle.split(' ').filter(Boolean))
    const candidateTokens = new Set(candidateTitle.split(' ').filter(Boolean))
    let overlap = 0
    for (const token of movieTokens) {
      if (candidateTokens.has(token)) overlap++
    }
    score += overlap * 12
  }

  const candidateYear = extractYear(entity)
  if (movie.year && candidateYear) {
    const diff = Math.abs(movie.year - candidateYear)
    if (diff === 0) score += 40
    else if (diff === 1) score += 20
    else if (diff <= 2) score += 8
    else score -= Math.min(diff * 2, 30)
  }

  return score
}

async function findBestWikidataMatch(movie, language) {
  const ids = await wikidataSearchIds(movie.title, language)
  if (!ids.length) return null

  const entities = await wikidataGetEntities(ids, language)
  const candidates = []

  for (const id of ids) {
    const entity = entities[id]
    if (!entity || entity.missing) continue
    if (!isLikelyFilmEntity(entity, language)) continue

    candidates.push({ id, entity, score: scoreCandidate(movie, entity, language) })
  }

  if (!candidates.length) return null

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (best.score < 25) return null

  const claims = best.entity.claims || {}
  const genreIds = extractEntityIdsFromClaims(claims, 'P136', 8)
  const castIds = extractEntityIdsFromClaims(claims, 'P161', 12)
  const directorIds = extractEntityIdsFromClaims(claims, 'P57', 3)

  const metadataIds = Array.from(new Set([...genreIds, ...castIds, ...directorIds]))
  const labels = await fetchEntityLabels(metadataIds, language)

  const genres = genreIds.map((id) => labels.get(id)).filter(Boolean)
  const cast = castIds.map((id) => labels.get(id)).filter(Boolean)
  const director = directorIds.map((id) => labels.get(id)).find(Boolean)

  const imdbId = claims?.P345?.[0]?.mainsnak?.datavalue?.value
  const runtimeRaw = claims?.P2047?.[0]?.mainsnak?.datavalue?.value?.amount
  const runtime = runtimeRaw ? Math.round(Number.parseFloat(runtimeRaw)) : undefined

  const posterFile = claims?.P3383?.[0]?.mainsnak?.datavalue?.value
  const imageFile = claims?.P18?.[0]?.mainsnak?.datavalue?.value
  const preferredImage = posterFile || imageFile
  const coverUrl = preferredImage
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(preferredImage.replace(/ /g, '_'))}?width=300`
    : undefined

  const title = titleFromEntity(best.entity, language, movie.title)
  const enTitle = best.entity?.labels?.en?.value
  const originalTitle = enTitle && enTitle !== title ? enTitle : undefined

  const description =
    best.entity?.descriptions?.[language]?.value ||
    best.entity?.descriptions?.en?.value ||
    undefined

  return {
    score: best.score,
    wikidata_id: best.id,
    title,
    original_title: originalTitle,
    year: extractYear(best.entity),
    genres,
    cast_members: cast,
    director,
    description,
    imdb_id: imdbId,
    runtime,
    cover_url: coverUrl,
  }
}

function hasMetadata(movie) {
  const hasGenres = Array.isArray(movie.genres) && movie.genres.length > 0
  const hasCast = Array.isArray(movie.cast_members) && movie.cast_members.length > 0
  const hasDirector = typeof movie.director === 'string' && movie.director.trim().length > 0
  const hasWikidata = typeof movie.wikidata_id === 'string' && movie.wikidata_id.trim().length > 0
  return hasGenres && hasCast && hasDirector && hasWikidata
}

function mergeUpdates(existing, candidate) {
  const patch = {}

  const fields = [
    'wikidata_id',
    'original_title',
    'year',
    'genres',
    'cast_members',
    'director',
    'description',
    'imdb_id',
    'runtime',
    'cover_url',
  ]

  for (const field of fields) {
    const nextValue = candidate[field]
    const currentValue = existing[field]

    if (Array.isArray(nextValue)) {
      if (nextValue.length > 0 && JSON.stringify(nextValue) !== JSON.stringify(currentValue || [])) {
        patch[field] = nextValue
      }
      continue
    }

    if (
      nextValue !== undefined &&
      nextValue !== null &&
      nextValue !== '' &&
      nextValue !== currentValue
    ) {
      patch[field] = nextValue
    }
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString()
  }

  return patch
}

async function main() {
  const args = parseArgs(process.argv)

  if (!args.url || !args.key) {
    printHelp()
    throw new Error('Supabase URL oder Key fehlt.')
  }

  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error('delay-ms muss eine Zahl >= 0 sein.')
  }

  const client = createClient(args.url, args.key)

  console.log('Lade Filme aus Supabase...')
  const { data, error } = await client
    .from('movies')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Supabase Fehler beim Laden: ${error.message}`)
  }

  const movies = Array.isArray(data) ? data : []
  const queue = args.force ? movies : movies.filter((movie) => !hasMetadata(movie))
  const total = args.max > 0 ? Math.min(args.max, queue.length) : queue.length

  console.log(`Gefundene Filme: ${movies.length}`)
  console.log(`Zu verarbeiten: ${total} (force=${args.force}, dryRun=${args.dryRun}, delay=${args.delayMs}ms)`)

  let success = 0
  let skippedNoMatch = 0
  let skippedNoChange = 0
  let failed = 0

  for (let index = 0; index < total; index++) {
    const movie = queue[index]
    const label = `${index + 1}/${total}`
    const yearText = movie.year ? ` (${movie.year})` : ''
    console.log(`\n[${label}] ${movie.title}${yearText}`)

    try {
      const candidate = await findBestWikidataMatch(movie, args.language)
      if (!candidate) {
        skippedNoMatch++
        console.log('  -> Kein passender Wikidata-Film gefunden (skip).')
      } else {
        const patch = mergeUpdates(movie, candidate)
        if (Object.keys(patch).length === 0) {
          skippedNoChange++
          console.log('  -> Keine neuen Felder zu aktualisieren (skip).')
        } else if (args.dryRun) {
          success++
          console.log(`  -> Dry-run Update: ${Object.keys(patch).join(', ')}`)
        } else {
          const { error: updateError } = await client
            .from('movies')
            .update(patch)
            .eq('id', movie.id)

          if (updateError) {
            failed++
            console.log(`  -> Supabase Update fehlgeschlagen: ${updateError.message}`)
          } else {
            success++
            console.log(`  -> Aktualisiert: ${Object.keys(patch).join(', ')}`)
          }
        }
      }
    } catch (e) {
      failed++
      const message = e instanceof Error ? e.message : String(e)
      console.log(`  -> Fehler: ${message}`)
    }

    if (index < total - 1 && args.delayMs > 0) {
      await sleep(args.delayMs)
    }
  }

  console.log('\nFertig.')
  console.log(`Erfolgreich: ${success}`)
  console.log(`Kein Match: ${skippedNoMatch}`)
  console.log(`Keine Aenderung: ${skippedNoChange}`)
  console.log(`Fehler: ${failed}`)

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
