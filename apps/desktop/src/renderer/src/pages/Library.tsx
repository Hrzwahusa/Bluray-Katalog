import React, { useState, useEffect, useCallback } from 'react'
import type { AppSettings } from '../App'
import type { Movie } from '@shared/types'
import { getAllMovies, deleteMovie, updateMovie } from '@shared/supabase'
import { MovieCard } from '../components/MovieCard'
import { MovieDetail } from '../components/MovieDetail'
import { Search, Camera } from '../components/Icons'

interface LibraryProps {
  settings: AppSettings
  onScanClick: () => void
}

export function Library({ settings, onScanClick }: LibraryProps) {
  const [movies, setMovies] = useState<Movie[]>([])
  const [filtered, setFiltered] = useState<Movie[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
  const [genreFilter, setGenreFilter] = useState<string>('Alle')

  const hasDb = settings.supabaseUrl && settings.supabaseKey

  const loadMovies = useCallback(async () => {
    if (!hasDb) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      setError(null)
      const data = await getAllMovies(settings.supabaseUrl, settings.supabaseKey)
      setMovies(data)
      setFiltered(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [settings, hasDb])

  useEffect(() => {
    loadMovies()
  }, [loadMovies])

  // Suche & Filter
  useEffect(() => {
    let result = movies
    if (genreFilter !== 'Alle') {
      result = result.filter((m) => m.genres?.includes(genreFilter))
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.original_title?.toLowerCase().includes(q) ||
          m.cast_members?.some((a) => a.toLowerCase().includes(q)) ||
          m.director?.toLowerCase().includes(q)
      )
    }
    setFiltered(result)
  }, [query, movies, genreFilter])

  const allGenres = ['Alle', ...Array.from(new Set(movies.flatMap((m) => m.genres || []))).sort()]

  const handleDelete = async (id: string) => {
    if (!window.confirm('Film wirklich löschen?')) return
    await deleteMovie(id, settings.supabaseUrl, settings.supabaseKey)
    await loadMovies()
    setSelectedMovie(null)
  }

  const handleSave = async (movie: Movie) => {
    const updated = await updateMovie(movie, settings.supabaseUrl, settings.supabaseKey)
    await loadMovies()
    setSelectedMovie(updated)
  }

  if (selectedMovie) {
    return (
      <MovieDetail
        movie={selectedMovie}
        onBack={() => setSelectedMovie(null)}
        onDelete={() => selectedMovie.id && handleDelete(selectedMovie.id)}
        onSave={handleSave}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-700 bg-slate-800 shrink-0">
        <h1 className="text-xl font-bold text-white">Meine Bibliothek</h1>
        <span className="text-slate-400 text-sm">({filtered.length} Filme)</span>
        <div className="flex-1" />
        <button
          onClick={onScanClick}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <span className="w-4 h-4"><Camera /></span>
          Cover scannen
        </button>
      </div>

      {/* Such- und Filterleiste */}
      <div className="flex items-center gap-4 px-6 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400">
            <Search />
          </span>
          <input
            type="text"
            placeholder="Suche nach Titel, Schauspieler, Regisseur..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-700 text-white placeholder-slate-400 rounded-lg text-sm border border-slate-600 focus:border-brand-500 focus:outline-none"
          />
        </div>

        {/* Genre-Filter */}
        <div className="flex gap-2 overflow-x-auto no-drag">
          {allGenres.slice(0, 8).map((genre) => (
            <button
              key={genre}
              onClick={() => setGenreFilter(genre)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors
                ${genreFilter === genre
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
            >
              {genre}
            </button>
          ))}
        </div>
      </div>

      {/* Inhalt */}
      <div className="flex-1 overflow-y-auto p-6">
        {!hasDb && (
          <EmptyState
            title="Datenbank nicht konfiguriert"
            message="Bitte Supabase-URL und API-Key in den Einstellungen hinterlegen."
          />
        )}
        {hasDb && loading && (
          <div className="flex items-center justify-center h-40">
            <div className="text-slate-400">Lade Bibliothek...</div>
          </div>
        )}
        {hasDb && error && (
          <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            Fehler: {error}
          </div>
        )}
        {hasDb && !loading && !error && filtered.length === 0 && (
          <EmptyState
            title={movies.length === 0 ? 'Noch keine Filme' : 'Keine Treffer'}
            message={
              movies.length === 0
                ? 'Scannen Sie Ihr erstes Blu-ray Cover um loszulegen!'
                : 'Keine Filme gefunden. Bitte andere Suchbegriffe verwenden.'
            }
          />
        )}
        {!loading && filtered.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filtered.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                onClick={() => setSelectedMovie(movie)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-16 h-16 text-slate-600 mb-4">
        <Camera />
      </div>
      <h3 className="text-slate-300 font-semibold text-lg mb-2">{title}</h3>
      <p className="text-slate-500 text-sm max-w-xs">{message}</p>
    </div>
  )
}
