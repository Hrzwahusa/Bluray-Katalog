import type { Movie } from './types'

const SUPABASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeText(value?: string): string {
  return value?.trim().toLowerCase() ?? ''
}

function buildFingerprint(movie: Movie): string | null {
  const title = normalizeText(movie.title)
  if (!title) return null

  const year = movie.year ? String(movie.year) : ''
  const director = normalizeText(movie.director)
  return `${title}|${year}|${director}`
}

function getIdentityKeys(movie: Movie): string[] {
  const keys: string[] = []

  if (movie.id) {
    keys.push(`id:${movie.id}`)
  }

  if (movie.wikidata_id) {
    keys.push(`wikidata:${movie.wikidata_id}`)
  }

  const fingerprint = buildFingerprint(movie)
  if (fingerprint) {
    keys.push(`fingerprint:${fingerprint}`)
  }

  return keys
}

export type RemoteMovieApi = {
  load: () => Promise<Movie[]>
  save: (movie: Movie) => Promise<Movie>
  update: (movie: Movie) => Promise<Movie>
}

export function hasSupabaseMovieId(id?: string): boolean {
  return Boolean(id && SUPABASE_ID_PATTERN.test(id))
}

export function createLocalMovieId(): string {
  return `local:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function sortMoviesByTitle(movies: Movie[]): Movie[] {
  return [...movies].sort((left, right) => left.title.localeCompare(right.title, 'de', { sensitivity: 'base' }))
}

export function findMovieIndex(movies: Movie[], movie: Movie): number {
  const keys = new Set(getIdentityKeys(movie))
  if (keys.size === 0) return -1

  return movies.findIndex((entry) => getIdentityKeys(entry).some((key) => keys.has(key)))
}

export function upsertMovie(movies: Movie[], movie: Movie): Movie[] {
  const index = findMovieIndex(movies, movie)
  if (index === -1) {
    return sortMoviesByTitle([...movies, movie])
  }

  const next = [...movies]
  next[index] = {
    ...next[index],
    ...movie,
  }
  return sortMoviesByTitle(next)
}

export function replaceMovie(movies: Movie[], target: Movie, replacement: Movie): Movie[] {
  const index = findMovieIndex(movies, target)
  if (index === -1) {
    return upsertMovie(movies, replacement)
  }

  const next = [...movies]
  next[index] = {
    ...next[index],
    ...replacement,
  }
  return sortMoviesByTitle(next)
}

export function mergeMovieLists(currentMovies: Movie[], incomingMovies: Movie[]): Movie[] {
  return incomingMovies.reduce((movies, movie) => upsertMovie(movies, movie), sortMoviesByTitle(currentMovies))
}

export async function syncMovieRecord(movie: Movie, remoteApi: RemoteMovieApi): Promise<Movie> {
  if (hasSupabaseMovieId(movie.id)) {
    return remoteApi.update(movie)
  }

  return remoteApi.save({
    ...movie,
    id: undefined,
  })
}

export async function syncMovieList(localMovies: Movie[], remoteApi: RemoteMovieApi): Promise<Movie[]> {
  let syncedMovies = sortMoviesByTitle(localMovies)

  for (const localMovie of localMovies) {
    const remoteMovie = await syncMovieRecord(localMovie, remoteApi)
    syncedMovies = replaceMovie(syncedMovies, localMovie, remoteMovie)
  }

  const remoteMovies = await remoteApi.load()
  return mergeMovieLists(syncedMovies, remoteMovies)
}