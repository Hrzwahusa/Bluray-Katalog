import { File, Paths } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import {
  syncMovieList as sharedSyncMovieList,
  syncMovieRecord as sharedSyncMovieRecord,
  type Movie,
  type RemoteMovieApi,
  createLocalMovieId as sharedCreateLocalMovieId,
  findMovieIndex as sharedFindMovieIndex,
  hasSupabaseMovieId as sharedHasSupabaseMovieId,
  sortMoviesByTitle as sharedSortMoviesByTitle,
} from '@bluray-katalog/shared'

const MOVIES_FILE = new File(Paths.document, 'movies.json')
const SUPABASE_REQUEST_TIMEOUT_MS = 10000
const SUPABASE_SYNC_HARD_TIMEOUT_MS = 12000
let syncInFlightPromise: Promise<Movie[]> | null = null

type SupabaseConfig = {
  url: string
  key: string
}

function sortMoviesByTitleSafe(movies: Movie[]): Movie[] {
  if (typeof sharedSortMoviesByTitle === 'function') {
    try {
      return sharedSortMoviesByTitle(movies)
    } catch {
      // Fall back to robust local sort when shared helper receives malformed data.
    }
  }

  return [...movies].sort((left, right) => {
    const leftTitle = typeof left.title === 'string' ? left.title : String(left.title ?? '')
    const rightTitle = typeof right.title === 'string' ? right.title : String(right.title ?? '')
    return leftTitle.localeCompare(rightTitle, 'de', { sensitivity: 'base' })
  })
}

function findMovieIndexSafe(movies: Movie[], movie: Movie): number {
  if (typeof sharedFindMovieIndex === 'function') {
    return sharedFindMovieIndex(movies, movie)
  }

  return movies.findIndex((entry) => {
    if (entry.id && movie.id && entry.id === movie.id) return true
    if (entry.wikidata_id && movie.wikidata_id && entry.wikidata_id === movie.wikidata_id) return true
    return entry.title.trim().toLowerCase() === movie.title.trim().toLowerCase() && entry.year === movie.year
  })
}

function createLocalMovieIdSafe(): string {
  if (typeof sharedCreateLocalMovieId === 'function') {
    return sharedCreateLocalMovieId()
  }

  return `local:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hasSupabaseMovieIdSafe(id?: string): boolean {
  if (typeof sharedHasSupabaseMovieId === 'function') {
    return sharedHasSupabaseMovieId(id)
  }

  return Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
}

async function syncMovieListSafe(localMovies: Movie[], remoteApi: RemoteMovieApi): Promise<Movie[]> {
  if (typeof sharedSyncMovieList === 'function') {
    return sharedSyncMovieList(localMovies, remoteApi)
  }

  return localMovies
}

async function syncMovieRecordSafe(movie: Movie, remoteApi: RemoteMovieApi): Promise<Movie> {
  if (typeof sharedSyncMovieRecord === 'function') {
    return sharedSyncMovieRecord(movie, remoteApi)
  }

  if (hasSupabaseMovieIdSafe(movie.id)) {
    return remoteApi.update(movie)
  }

  return remoteApi.save({
    ...movie,
    id: undefined,
  })
}

function normalizeSupabaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function createSupabaseHeaders(key: string, withJson = false): HeadersInit {
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  }
  if (withJson) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string; error?: string; details?: string }
    return data.message || data.error || data.details || response.statusText
  } catch {
    return response.statusText
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const abortTimeoutId = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS)
  let rejectTimeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<Response>((_, reject) => {
    rejectTimeoutId = setTimeout(() => reject(new Error('Supabase request timeout')), SUPABASE_REQUEST_TIMEOUT_MS)
  })

  try {
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ])
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Supabase request timeout')
    }
    throw error
  } finally {
    clearTimeout(abortTimeoutId)
    if (rejectTimeoutId) {
      clearTimeout(rejectTimeoutId)
    }
  }
}

async function raceWithSyncHardTimeout(task: Promise<Movie[]>, inFlight: boolean): Promise<Movie[]> {
  return new Promise<Movie[]>((resolve) => {
    const timeoutId = setTimeout(async () => {
      console.warn(
        inFlight
          ? 'Supabase sync hard timeout (in-flight), using cached local movies'
          : 'Supabase sync hard timeout, using cached local movies'
      )
      resolve(await readLocalMovies())
    }, SUPABASE_SYNC_HARD_TIMEOUT_MS)

    task.then((movies) => {
      clearTimeout(timeoutId)
      resolve(movies)
    }).catch(async (error) => {
      clearTimeout(timeoutId)
      console.warn('Supabase sync task failed, using cached local movies:', error)
      resolve(await readLocalMovies())
    })
  })
}

async function getRemoteMovies(url: string, key: string): Promise<Movie[]> {
  const baseUrl = normalizeSupabaseUrl(url)
  const response = await fetchWithTimeout(`${baseUrl}/rest/v1/movies?select=*&order=title.asc`, {
    method: 'GET',
    headers: createSupabaseHeaders(key),
  })

  if (!response.ok) {
    throw new Error(`Supabase-Fehler beim Laden: ${await parseErrorMessage(response)}`)
  }

  return (await response.json()) as Movie[]
}

async function saveRemoteMovie(movie: Movie, url: string, key: string): Promise<Movie> {
  const baseUrl = normalizeSupabaseUrl(url)
  const payload: Movie = {
    ...movie,
    updated_at: new Date().toISOString(),
  }

  if (movie.wikidata_id) {
    const lookup = await fetchWithTimeout(
      `${baseUrl}/rest/v1/movies?select=id&wikidata_id=eq.${encodeURIComponent(movie.wikidata_id)}&limit=1`,
      {
        method: 'GET',
        headers: createSupabaseHeaders(key),
      }
    )

    if (!lookup.ok) {
      throw new Error(`Supabase-Fehler beim Nachschlagen: ${await parseErrorMessage(lookup)}`)
    }

    const existing = (await lookup.json()) as Array<{ id: string }>
    if (existing[0]?.id) {
      return updateRemoteMovie({ ...payload, id: existing[0].id }, url, key)
    }
  }

  const response = await fetchWithTimeout(`${baseUrl}/rest/v1/movies`, {
    method: 'POST',
    headers: {
      ...createSupabaseHeaders(key, true),
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      ...payload,
      id: undefined,
    }),
  })

  if (!response.ok) {
    throw new Error(`Supabase-Fehler beim Speichern: ${await parseErrorMessage(response)}`)
  }

  const rows = (await response.json()) as Movie[]
  return rows[0] as Movie
}

async function updateRemoteMovie(movie: Movie, url: string, key: string): Promise<Movie> {
  if (!movie.id) {
    throw new Error('Supabase-Fehler beim Aktualisieren: Film-ID fehlt')
  }

  const baseUrl = normalizeSupabaseUrl(url)
  const response = await fetchWithTimeout(`${baseUrl}/rest/v1/movies?id=eq.${encodeURIComponent(movie.id)}`, {
    method: 'PATCH',
    headers: {
      ...createSupabaseHeaders(key, true),
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      ...movie,
      updated_at: new Date().toISOString(),
    }),
  })

  if (!response.ok) {
    if (movie.wikidata_id) {
      return saveRemoteMovie({ ...movie, id: undefined }, url, key)
    }
    throw new Error(`Supabase-Fehler beim Aktualisieren: ${await parseErrorMessage(response)}`)
  }

  const rows = (await response.json()) as Movie[]
  return rows[0] as Movie
}

async function deleteRemoteMovie(id: string, url: string, key: string): Promise<void> {
  const baseUrl = normalizeSupabaseUrl(url)
  const response = await fetchWithTimeout(`${baseUrl}/rest/v1/movies?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: createSupabaseHeaders(key),
  })

  if (!response.ok) {
    throw new Error(`Supabase-Fehler beim Löschen: ${await parseErrorMessage(response)}`)
  }
}

function createRemoteApi(config: SupabaseConfig): RemoteMovieApi {
  return {
    load: () => getRemoteMovies(config.url, config.key),
    save: (movie) => saveRemoteMovie(movie, config.url, config.key),
    update: (movie) => updateRemoteMovie(movie, config.url, config.key),
  }
}

async function readLocalMovies(): Promise<Movie[]> {
  if (!MOVIES_FILE.exists) {
    return []
  }

  try {
    const raw = await MOVIES_FILE.text()
    if (!raw.trim()) return []

    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? sortMoviesByTitleSafe(parsed as Movie[]) : []
  } catch {
    return []
  }
}

async function writeLocalMovies(movies: Movie[]): Promise<void> {
  if (!MOVIES_FILE.exists) {
    MOVIES_FILE.create({ intermediates: true })
  }
  MOVIES_FILE.write(JSON.stringify(sortMoviesByTitleSafe(movies), null, 2), {
    encoding: 'utf8',
  })
}

async function getSupabaseConfig(): Promise<SupabaseConfig | null> {
  const url = (await SecureStore.getItemAsync('supabaseUrl'))?.trim()
  const key = (
    (await SecureStore.getItemAsync('supabaseKey')) ||
    (await SecureStore.getItemAsync('supabaseAnonKey'))
  )?.trim()

  if (!url || !key) {
    return null
  }

  return { url, key }
}

async function syncMoviesIfConfigured(localMovies: Movie[]): Promise<Movie[]> {
  const config = await getSupabaseConfig()
  if (!config) {
    console.log('Supabase sync skipped: no credentials configured')
    return sortMoviesByTitleSafe(localMovies)
  }

  try {
    console.log('Supabase sync started', { localCount: localMovies.length })
    const syncedMovies = await syncMovieListSafe(localMovies, createRemoteApi(config))
    await writeLocalMovies(syncedMovies)
    console.log('Supabase sync completed', { syncedCount: syncedMovies.length })
    return syncedMovies
  } catch (error) {
    console.warn('Supabase sync skipped, using local data:', error)
    return sortMoviesByTitleSafe(localMovies)
  }
}

function findExistingMovieIndex(movies: Movie[], movie: Movie): number {
  return findMovieIndexSafe(movies, movie)
}

export async function getStoredMovies(): Promise<Movie[]> {
  return syncStoredMoviesNow()
}

export async function getCachedMovies(): Promise<Movie[]> {
  return readLocalMovies()
}

export async function syncStoredMoviesNow(): Promise<Movie[]> {
  if (syncInFlightPromise) {
    return raceWithSyncHardTimeout(syncInFlightPromise, true)
  }

  const syncTask = (async () => {
    const localMovies = await readLocalMovies()
    const syncedMovies = await syncMoviesIfConfigured(localMovies)
    await writeLocalMovies(syncedMovies)
    return syncedMovies
  })().catch(async (error) => {
    console.warn('Supabase sync failed unexpectedly, using cached local movies:', error)
    return readLocalMovies()
  })()

  syncInFlightPromise = syncTask
  syncTask.finally(() => {
    if (syncInFlightPromise === syncTask) {
      syncInFlightPromise = null
    }
  })

  return raceWithSyncHardTimeout(syncTask, false)
}

export async function saveStoredMovie(movie: Movie): Promise<Movie> {
  const now = new Date().toISOString()
  const localMovies = await readLocalMovies()
  const existingIndex = findExistingMovieIndex(localMovies, movie)
  const existingMovie = existingIndex >= 0 ? localMovies[existingIndex] : undefined

  const storedMovie: Movie = {
    ...existingMovie,
    ...movie,
    id: existingMovie?.id || movie.id || createLocalMovieIdSafe(),
    created_at: existingMovie?.created_at || movie.created_at || now,
    updated_at: now,
  }

  const nextMovies = [...localMovies]
  if (existingIndex >= 0) {
    nextMovies[existingIndex] = storedMovie
  } else {
    nextMovies.push(storedMovie)
  }
  await writeLocalMovies(nextMovies)

  const config = await getSupabaseConfig()
  if (!config) {
    return storedMovie
  }

  try {
    const syncedMovie = await syncMovieRecordSafe(storedMovie, createRemoteApi(config))
    const syncedMovies = [...nextMovies]
    const syncedIndex = findExistingMovieIndex(syncedMovies, storedMovie)
    if (syncedIndex >= 0) {
      syncedMovies[syncedIndex] = syncedMovie
    } else {
      syncedMovies.push(syncedMovie)
    }
    await writeLocalMovies(syncedMovies)
    return syncedMovie
  } catch (error) {
    console.warn('Supabase sync for movie failed, keeping local movie:', error)
    return storedMovie
  }
}

export async function updateStoredMovie(movie: Movie): Promise<Movie> {
  return saveStoredMovie(movie)
}

export async function deleteStoredMovie(id: string): Promise<void> {
  const localMovies = await readLocalMovies()
  const movieToDelete = localMovies.find((movie) => movie.id === id)
  await writeLocalMovies(localMovies.filter((movie) => movie.id !== id))

  const config = await getSupabaseConfig()
  if (!config || !movieToDelete?.id || !hasSupabaseMovieIdSafe(movieToDelete.id)) {
    return
  }

  try {
    await deleteRemoteMovie(movieToDelete.id, config.url, config.key)
  } catch (error) {
    console.warn('Supabase delete failed, movie kept deleted locally:', error)
    // Keep local deletion even when remote sync fails.
  }
}