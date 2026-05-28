#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TOKEN_FILE = resolve(SCRIPT_DIR, '../tmdbapi.txt')

function parseArgs(argv) {
  const args = {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '',
    language: process.env.TMDB_LANG || 'de',
    delayMs: Number.parseInt(process.env.BACKFILL_DELAY_MS || '1200', 10),
    max: Number.parseInt(process.env.BACKFILL_MAX || '0', 10),
    force: false,
    dryRun: false,
    tokenFile: process.env.TMDB_TOKEN_FILE || DEFAULT_TOKEN_FILE,
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
    if (current === '--token-file' && next) {
      args.tokenFile = next
      i++
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
  console.log('TMDB-Backfill fuer BluRay-Katalog.')
  console.log('')
  console.log('Behaelt den bestehenden Titel aus Supabase und fuellt den Rest aus TMDB neu.')
  console.log('')
  console.log('Nutzung:')
  console.log('  npm run metadata:backfill -- --url <SUPABASE_URL> --key <SUPABASE_KEY> [Optionen]')
  console.log('')
  console.log('Optionen:')
  console.log('  --language <de|en>   TMDB-Sprache fuer die Suche (Standard: de)')
  console.log('  --delay-ms <zahl>    Pause zwischen Filmen in ms (Standard: 1200)')
  console.log('  --max <zahl>         Maximal zu bearbeitende Filme (0 = alle)')
  console.log('  --force              Vorhandene Metadaten ebenfalls ueberschreiben')
  console.log('  --dry-run            Keine DB-Updates schreiben, nur anzeigen')
  console.log('  --token-file <pfad>  TMDB-Token-Datei (Standard: ./tmdbapi.txt)')
  console.log('')
  console.log('Alternativ ueber Umgebungsvariablen: SUPABASE_URL, SUPABASE_KEY, TMDB_TOKEN_FILE')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options = {}, retries = 4) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BluRay-Katalog-TMDB-Backfill/1.0',
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

function normalizeYear(value) {
  if (!value || typeof value !== 'string') return undefined
  const match = value.match(/^(\d{4})-/)
  if (!match) return undefined
  const year = Number.parseInt(match[1], 10)
  return Number.isFinite(year) ? year : undefined
}

function parseFileToken(path) {
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw) throw new Error(`TMDB-Token-Datei leer: ${path}`)
  return raw.replace(/^TMDB_API_TOKEN\s*=\s*/i, '').trim()
}

function buildSearchTerms(title) {
  const cleaned = title.replace(/\(.*?\)/g, ' ').replace(/[.,!?]+$/g, '').trim()
  const terms = new Set([cleaned])

  const normalized = normalizeText(cleaned)
  if (normalized) {
    terms.add(cleaned.replace(/[:|]/g, ' '))
    terms.add(cleaned.replace(/[-\u2010-\u2015]/g, ' '))
    terms.add(cleaned.replace(/[-\u2010-\u2015]/g, ''))
  }

  terms.add(`${cleaned} film`)
  terms.add(`${cleaned} movie`)

  return Array.from(terms).map((term) => term.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8)
}

function scoreCandidate(movie, queryNorm, queryTokens, queryYear) {
  const titleNorm = normalizeText(movie.title || '')
  const originalNorm = normalizeText(movie.original_title || '')
  const haystacks = [titleNorm, originalNorm].filter(Boolean)

  let score = 0

  if (haystacks.some((value) => value === queryNorm)) score += 220
  if (haystacks.some((value) => value.startsWith(queryNorm))) score += 130
  if (haystacks.some((value) => value.includes(queryNorm))) score += 90

  const tokenHits = queryTokens.filter((token) => haystacks.some((value) => value.includes(token))).length
  score += tokenHits * 22

  if (movie.poster_path) score += 10
  if (movie.adult) score -= 50

  const releaseYear = normalizeYear(movie.release_date)
  if (queryYear && releaseYear) {
    const diff = Math.abs(queryYear - releaseYear)
    if (diff === 0) score += 45
    else if (diff === 1) score += 20
    else if (diff <= 2) score += 8
    else score -= Math.min(diff * 2, 30)
  }

  return score
}

function toPosterUrl(posterPath) {
  if (!posterPath) return undefined
  return `https://image.tmdb.org/t/p/w500${posterPath}`
}

function buildPatch(movie, details) {
  const patch = {}

  const originalTitle = details.original_title && details.original_title !== movie.title
    ? details.original_title.trim()
    : undefined
  if (originalTitle) patch.original_title = originalTitle

  const year = normalizeYear(details.release_date)
  if (Number.isFinite(year)) patch.year = year

  patch.genres = (details.genres || [])
    .map((entry) => entry.name?.trim())
    .filter(Boolean)

  patch.cast_members = (details.credits?.cast || [])
    .map((entry) => entry.name?.trim())
    .filter(Boolean)
    .slice(0, 10)

  const director = (details.credits?.crew || [])
    .find((entry) => entry.job === 'Director' || entry.department === 'Directing')
    ?.name?.trim()
  if (director) patch.director = director

  if (details.overview && details.overview.trim()) patch.description = details.overview.trim()

  const coverUrl = toPosterUrl(details.poster_path)
  if (coverUrl) patch.cover_url = coverUrl

  patch.wikidata_id = String(details.id)

  if (details.external_ids?.imdb_id) patch.imdb_id = details.external_ids.imdb_id
  if (Number.isFinite(details.runtime)) patch.runtime = Math.round(details.runtime)
  if (details.original_language) patch.language = details.original_language

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString()
  }

  return patch
}

async function searchBestMovie(title, language, token) {
  const queryNorm = normalizeText(title)
  const queryTokens = queryNorm.split(' ').filter(Boolean)
  const searchLanguages = Array.from(new Set([language === 'de' ? 'de-DE' : 'en-US', 'en-US']))
  const searchTerms = buildSearchTerms(title)
  const resultsById = new Map()

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
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) continue
        const data = await response.json()
        for (const movie of data.results || []) {
          if (!movie?.id || !movie.title) continue
          if (!resultsById.has(movie.id)) resultsById.set(movie.id, movie)
        }
      } catch {
        // weitere Varianten probieren
      }
    }
  }

  const scored = Array.from(resultsById.values())
    .map((movie) => ({ movie, score: scoreCandidate(movie, queryNorm, queryTokens, undefined) }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      const aYear = normalizeYear(a.movie.release_date) || 0
      const bYear = normalizeYear(b.movie.release_date) || 0
      if (aYear !== bYear) return bYear - aYear
      return (b.movie.popularity || 0) - (a.movie.popularity || 0)
    })

  return scored[0]?.movie || null
}

async function fetchMovieDetails(id, language, token) {
  const params = new URLSearchParams({
    language: language === 'de' ? 'de-DE' : 'en-US',
    append_to_response: 'credits,external_ids',
  })

  const response = await fetchWithRetry(`${TMDB_API_BASE}/movie/${id}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) return null
  return await response.json()
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

  const token = process.env.TMDB_API_TOKEN || parseFileToken(args.tokenFile)
  const client = createClient(args.url, args.key)

  console.log('Lade Filme aus Supabase...')
  const { data, error } = await client.from('movies').select('*').order('created_at', { ascending: true })
  if (error) {
    throw new Error(`Supabase Fehler beim Laden: ${error.message}`)
  }

  const movies = Array.isArray(data) ? data : []
  const queue = movies
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
      const best = await searchBestMovie(movie.title, args.language, token)
      if (!best) {
        skippedNoMatch++
        console.log('  -> Kein passender TMDB-Film gefunden (skip).')
      } else {
        const details = await fetchMovieDetails(best.id, args.language, token)
        if (!details) {
          skippedNoMatch++
          console.log('  -> TMDB-Details nicht abrufbar (skip).')
        } else {
          const patch = buildPatch(movie, details)
          if (Object.keys(patch).length === 1 && patch.updated_at) {
            skippedNoChange++
            console.log('  -> Keine neuen Felder zu aktualisieren (skip).')
          } else if (Object.keys(patch).length === 0) {
            skippedNoChange++
            console.log('  -> Keine neuen Felder zu aktualisieren (skip).')
          } else if (args.dryRun) {
            success++
            console.log(`  -> Dry-run Update: ${Object.keys(patch).join(', ')}`)
          } else {
            const { error: updateError } = await client.from('movies').update(patch).eq('id', movie.id)
            if (updateError) {
              failed++
              console.log(`  -> Supabase Update fehlgeschlagen: ${updateError.message}`)
            } else {
              success++
              console.log(`  -> Aktualisiert: ${Object.keys(patch).join(', ')}`)
            }
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