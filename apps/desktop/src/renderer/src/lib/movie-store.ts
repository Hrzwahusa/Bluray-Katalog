import type { Movie } from '@shared/types'
import {
  createLocalMovieId,
  findMovieIndex,
  hasSupabaseMovieId,
  mergeMovieLists,
  sortMoviesByTitle,
  syncMovieList,
  syncMovieRecord,
  type RemoteMovieApi,
} from '@shared'
import {
  deleteMovie as deleteRemoteMovie,
  getAllMovies as getRemoteMovies,
  saveMovie as saveRemoteMovie,
  updateMovie as updateRemoteMovie,
} from '@shared/supabase'
import type { AppSettings } from '../App'

function createRemoteApi(settings: AppSettings): RemoteMovieApi {
  return {
    load: () => getRemoteMovies(settings.supabaseUrl, settings.supabaseKey),
    save: (movie) => saveRemoteMovie(movie, settings.supabaseUrl, settings.supabaseKey),
    update: (movie) => updateRemoteMovie(movie, settings.supabaseUrl, settings.supabaseKey),
  }
}

function hasSupabaseConfig(settings: AppSettings): boolean {
  return Boolean(settings.supabaseUrl.trim() && settings.supabaseKey.trim())
}

async function readLocalMovies(): Promise<Movie[]> {
  return sortMoviesByTitle(await window.api.getLocalMovies())
}

async function writeLocalMovies(movies: Movie[]): Promise<void> {
  await window.api.setLocalMovies(sortMoviesByTitle(movies))
}

export async function getStoredMovies(settings: AppSettings): Promise<Movie[]> {
  const localMovies = await readLocalMovies()
  if (!hasSupabaseConfig(settings)) {
    return localMovies
  }

  try {
    const syncedMovies = await syncMovieList(localMovies, createRemoteApi(settings))
    await writeLocalMovies(syncedMovies)
    return syncedMovies
  } catch {
    return localMovies
  }
}

export async function saveStoredMovie(movie: Movie, settings: AppSettings): Promise<Movie> {
  const now = new Date().toISOString()
  const localMovies = await readLocalMovies()
  const existingIndex = findMovieIndex(localMovies, movie)
  const existingMovie = existingIndex >= 0 ? localMovies[existingIndex] : undefined

  const storedMovie: Movie = {
    ...existingMovie,
    ...movie,
    id: existingMovie?.id || movie.id || createLocalMovieId(),
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

  if (!hasSupabaseConfig(settings)) {
    return storedMovie
  }

  try {
    const syncedMovie = await syncMovieRecord(storedMovie, createRemoteApi(settings))
    const mergedMovies = mergeMovieLists(
      nextMovies.filter((entry) => entry.id !== storedMovie.id),
      [syncedMovie]
    )
    await writeLocalMovies(mergedMovies)
    return syncedMovie
  } catch {
    return storedMovie
  }
}

export async function updateStoredMovie(movie: Movie, settings: AppSettings): Promise<Movie> {
  return saveStoredMovie(movie, settings)
}

export async function deleteStoredMovie(id: string, settings: AppSettings): Promise<void> {
  const localMovies = await readLocalMovies()
  const movieToDelete = localMovies.find((movie) => movie.id === id)
  await writeLocalMovies(localMovies.filter((movie) => movie.id !== id))

  if (!hasSupabaseConfig(settings) || !movieToDelete?.id || !hasSupabaseMovieId(movieToDelete.id)) {
    return
  }

  try {
    await deleteRemoteMovie(movieToDelete.id, settings.supabaseUrl, settings.supabaseKey)
  } catch {
    // Keep local deletion even when remote sync fails.
  }
}