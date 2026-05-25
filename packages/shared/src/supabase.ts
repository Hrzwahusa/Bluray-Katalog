import { createClient } from '@supabase/supabase-js'
import type { Movie } from './types'

export function createSupabaseClient(url: string, anonKey: string) {
  return createClient(url, anonKey)
}

export async function saveMovie(movie: Movie, supabaseUrl: string, supabaseKey: string): Promise<Movie> {
  const client = createSupabaseClient(supabaseUrl, supabaseKey)
  const { data, error } = await client
    .from('movies')
    .upsert(
      {
        ...movie,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wikidata_id' }
    )
    .select()
    .single()

  if (error) throw new Error(`Supabase-Fehler beim Speichern: ${error.message}`)
  return data as Movie
}

export async function getAllMovies(supabaseUrl: string, supabaseKey: string): Promise<Movie[]> {
  const client = createSupabaseClient(supabaseUrl, supabaseKey)
  const { data, error } = await client
    .from('movies')
    .select('*')
    .order('title', { ascending: true })

  if (error) throw new Error(`Supabase-Fehler beim Laden: ${error.message}`)
  return (data || []) as Movie[]
}

export async function searchMoviesInDb(
  query: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<Movie[]> {
  const client = createSupabaseClient(supabaseUrl, supabaseKey)
  const { data, error } = await client
    .from('movies')
    .select('*')
    .or(`title.ilike.%${query}%,original_title.ilike.%${query}%,cast_members.cs.{${query}}`)
    .order('title', { ascending: true })

  if (error) throw new Error(`Supabase-Suchfehler: ${error.message}`)
  return (data || []) as Movie[]
}

export async function deleteMovie(id: string, supabaseUrl: string, supabaseKey: string): Promise<void> {
  const client = createSupabaseClient(supabaseUrl, supabaseKey)
  const { error } = await client.from('movies').delete().eq('id', id)
  if (error) throw new Error(`Supabase-Fehler beim Löschen: ${error.message}`)
}

export async function updateMovie(movie: Movie, supabaseUrl: string, supabaseKey: string): Promise<Movie> {
  if (!movie.id) throw new Error('Supabase-Fehler beim Aktualisieren: Film-ID fehlt')

  const client = createSupabaseClient(supabaseUrl, supabaseKey)
  const { data, error } = await client
    .from('movies')
    .update({
      ...movie,
      updated_at: new Date().toISOString(),
    })
    .eq('id', movie.id)
    .select()
    .single()

  if (error) throw new Error(`Supabase-Fehler beim Aktualisieren: ${error.message}`)
  return data as Movie
}
