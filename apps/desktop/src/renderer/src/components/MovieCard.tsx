import React from 'react'
import type { Movie } from '@shared/types'

interface MovieCardProps {
  movie: Movie
  onClick: () => void
}

export function MovieCard({ movie, onClick }: MovieCardProps) {
  const posterUrl = movie.cover_url && !movie.cover_url.startsWith('data:') ? movie.cover_url : undefined

  return (
    <button
      onClick={onClick}
      className="group flex flex-col bg-slate-800 rounded-xl overflow-hidden border border-slate-700 hover:border-brand-500 transition-all duration-200 hover:shadow-lg hover:shadow-brand-900/30 text-left"
    >
      {/* Cover-Bild */}
      <div className="relative aspect-[2/3] bg-slate-700 overflow-hidden">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={movie.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={(e) => {
              const img = e.target as HTMLImageElement
              img.style.display = 'none'
              img.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        {/* Fallback wenn kein Bild */}
        <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-600 ${posterUrl ? 'hidden' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1} className="w-10 h-10">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5" />
          </svg>
          <span className="text-xs text-center px-2 leading-tight font-medium">{movie.title}</span>
        </div>

        {/* Jahr-Badge */}
        {movie.year && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded font-mono">
            {movie.year}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2">
        <p className="text-white text-xs font-semibold leading-tight line-clamp-2">{movie.title}</p>
        {movie.genres && movie.genres.length > 0 && (
          <p className="text-slate-500 text-xs mt-0.5 truncate">{movie.genres[0]}</p>
        )}
      </div>
    </button>
  )
}
