import React from 'react'
import type { Movie } from '@shared/types'
import { ChevronLeft, Trash } from './Icons'

interface MovieDetailProps {
  movie: Movie
  onBack: () => void
  onDelete: () => void
}

export function MovieDetail({ movie, onBack, onDelete }: MovieDetailProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-700 bg-slate-800 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm"
        >
          <span className="w-4 h-4"><ChevronLeft /></span>
          Zurück
        </button>
        <h1 className="flex-1 text-xl font-bold text-white truncate">{movie.title}</h1>
        <button
          onClick={onDelete}
          className="flex items-center gap-2 px-3 py-2 bg-red-900/40 hover:bg-red-800/60 text-red-400 hover:text-red-300 rounded-lg text-sm transition-colors"
        >
          <span className="w-4 h-4"><Trash /></span>
          Löschen
        </button>
      </div>

      {/* Inhalt */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl flex gap-8">
          {/* Cover */}
          <div className="w-48 shrink-0 space-y-3">
            {movie.cover_url && !movie.cover_url.startsWith('data:') ? (
              <img
                src={movie.cover_url}
                alt={movie.title}
                className="w-full rounded-xl shadow-2xl"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="w-full aspect-[2/3] bg-slate-800 rounded-xl flex items-center justify-center text-slate-600">
                Kein Cover
              </div>
            )}

          </div>

          {/* Details */}
          <div className="flex-1 space-y-6">
            <div>
              <h2 className="text-3xl font-bold text-white">{movie.title}</h2>
              {movie.original_title && movie.original_title !== movie.title && (
                <p className="text-slate-400 text-lg mt-0.5">{movie.original_title}</p>
              )}
            </div>

            {/* Metadaten-Grid */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <MetaRow label="Erscheinungsjahr" value={movie.year?.toString()} />
              <MetaRow label="Regie" value={movie.director} />
              <MetaRow label="Laufzeit" value={movie.runtime ? `${movie.runtime} Minuten` : undefined} />
              <MetaRow label="Bewertung" value={movie.rating ? `${movie.rating}/10` : undefined} />
              <MetaRow label="Sprache" value={movie.language} />
              <MetaRow label="IMDb-ID" value={movie.imdb_id} />
            </div>

            {/* Genres */}
            {movie.genres && movie.genres.length > 0 && (
              <div>
                <h3 className="text-slate-500 text-sm font-medium mb-2">Genres</h3>
                <div className="flex flex-wrap gap-2">
                  {movie.genres.map((g) => (
                    <span
                      key={g}
                      className="px-3 py-1 bg-brand-900 text-brand-300 rounded-full text-sm border border-brand-800"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Hauptdarsteller */}
            {movie.cast_members && movie.cast_members.length > 0 && (
              <div>
                <h3 className="text-slate-500 text-sm font-medium mb-2">Hauptdarsteller</h3>
                <div className="flex flex-wrap gap-2">
                  {movie.cast_members.map((actor) => (
                    <span
                      key={actor}
                      className="px-3 py-1 bg-slate-800 text-slate-300 rounded-full text-sm border border-slate-700"
                    >
                      {actor}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Beschreibung */}
            {movie.description && (
              <div>
                <h3 className="text-slate-500 text-sm font-medium mb-2">Beschreibung</h3>
                <p className="text-slate-300 text-sm leading-relaxed">{movie.description}</p>
              </div>
            )}

            {/* Zeitstempel */}
            {movie.created_at && (
              <p className="text-slate-600 text-xs">
                Hinzugefügt: {new Date(movie.created_at).toLocaleDateString('de-DE', { dateStyle: 'long' })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-slate-500 text-xs font-medium">{label}</dt>
      <dd className="text-slate-200 text-sm mt-0.5">{value}</dd>
    </div>
  )
}
