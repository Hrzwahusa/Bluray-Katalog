import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { AppSettings } from '../App'
import type { Movie } from '@shared/types'
import { getAllMovies, deleteMovie, updateMovie } from '@shared/supabase'
import { MovieCard } from '../components/MovieCard'
import { MovieDetail } from '../components/MovieDetail'
import { Search, Camera } from '../components/Icons'

const LIBRARY_VIEW_MODE_KEY = 'libraryViewMode'

interface LibraryProps {
  settings: AppSettings
  onScanClick: () => void
}

export function Library({ settings, onScanClick }: LibraryProps) {
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery')
  const [movies, setMovies] = useState<Movie[]>([])
  const [filtered, setFiltered] = useState<Movie[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
  const [genreFilter, setGenreFilter] = useState<string>('Alle')
  const [restoreSearchFocus, setRestoreSearchFocus] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    const stored = localStorage.getItem(LIBRARY_VIEW_MODE_KEY)
    if (stored === 'gallery' || stored === 'list') {
      setViewMode(stored)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(LIBRARY_VIEW_MODE_KEY, viewMode)
  }, [viewMode])

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
    setIsDeleting(true)
    try {
      await deleteMovie(id, settings.supabaseUrl, settings.supabaseKey)
      await loadMovies()
      setRestoreSearchFocus(true)
      setSelectedMovie(null)
      setDeleteConfirmOpen(false)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSave = async (movie: Movie) => {
    const updated = await updateMovie(movie, settings.supabaseUrl, settings.supabaseKey)
    await loadMovies()
    setSelectedMovie(updated)
  }

  const handleApplyDetailFilter = (type: 'genre' | 'actor', value: string) => {
    if (type === 'genre') {
      setGenreFilter(value)
      setQuery('')
    } else {
      setGenreFilter('Alle')
      setQuery(value)
    }
    setViewMode('gallery')
    setDeleteConfirmOpen(false)
    setSelectedMovie(null)
  }

  useEffect(() => {
    if (selectedMovie !== null || !restoreSearchFocus) return
    const id = setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
      setRestoreSearchFocus(false)
    }, 0)
    return () => clearTimeout(id)
  }, [selectedMovie, restoreSearchFocus])

  if (selectedMovie) {
    return (
      <>
        <MovieDetail
          movie={selectedMovie}
          onBack={() => {
            setDeleteConfirmOpen(false)
            setRestoreSearchFocus(true)
            setSelectedMovie(null)
          }}
          onDelete={() => setDeleteConfirmOpen(true)}
          onSave={handleSave}
          onApplyFilter={handleApplyDetailFilter}
        />

        {deleteConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 no-drag">
            <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
              <h2 className="text-lg font-semibold text-white">Film wirklich löschen?</h2>
              <p className="mt-2 text-sm text-slate-300">
                Dieser Eintrag wird dauerhaft entfernt.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setDeleteConfirmOpen(false)}
                  disabled={isDeleting}
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm transition-colors disabled:opacity-60"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => selectedMovie.id && handleDelete(selectedMovie.id)}
                  disabled={isDeleting}
                  className="px-3 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm transition-colors disabled:opacity-60"
                >
                  {isDeleting ? 'Lösche...' : 'Löschen'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
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
      <div className="flex items-center gap-4 px-6 py-3 bg-slate-800 border-b border-slate-700 shrink-0 no-drag">
        <div className="relative flex-1 max-w-md no-drag">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400">
            <Search />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Suche nach Titel, Schauspieler, Regisseur..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-700 text-white placeholder-slate-400 rounded-lg text-sm border border-slate-600 focus:border-brand-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-900/60 border border-slate-700 p-1 no-drag">
          <button
            onClick={() => setViewMode('gallery')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'gallery'
                ? 'bg-brand-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            Galerie
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-brand-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            Liste
          </button>
        </div>

        {/* Genre-Filter als Dropdown */}
        <div className="flex items-center gap-2 no-drag">
          <label htmlFor="genreFilter" className="text-xs text-slate-400">Genre</label>
          <select
            id="genreFilter"
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-700 text-slate-100 text-sm border border-slate-600 focus:border-brand-500 focus:outline-none"
          >
            {allGenres.map((genre) => (
              <option key={genre} value={genre}>{genre}</option>
            ))}
          </select>
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
        {!loading && filtered.length > 0 && viewMode === 'gallery' && (
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
        {!loading && filtered.length > 0 && viewMode === 'list' && (
          <div className="flex flex-col gap-2">
            {filtered.map((movie) => {
              const posterUrl = movie.cover_url && !movie.cover_url.startsWith('data:') ? movie.cover_url : undefined
              return (
                <button
                  key={movie.id}
                  onClick={() => setSelectedMovie(movie)}
                  className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/90 hover:border-brand-500 hover:bg-slate-800 px-3 py-2 text-left transition-colors"
                >
                  <div className="w-12 h-16 shrink-0 rounded-md overflow-hidden bg-slate-700 flex items-center justify-center">
                    {posterUrl ? (
                      <img src={posterUrl} alt={movie.title} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <span className="text-slate-500 text-lg">[]</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-semibold truncate">{movie.title}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {[
                        movie.year ? String(movie.year) : undefined,
                        movie.director,
                        movie.genres?.[0],
                      ].filter(Boolean).join(' | ') || 'Keine Zusatzinfos'}
                    </p>
                  </div>
                </button>
              )
            })}
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
