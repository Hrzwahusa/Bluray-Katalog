import React, { useEffect, useMemo, useState } from 'react'
import type { Movie } from '@shared/types'
import { ChevronLeft, Trash } from './Icons'
import { TMDB_ATTRIBUTION_NOTICE } from '@shared/tmdb'
import tmdbLogo from '../assets/tmdb-logo.svg'
import { useI18n } from '../i18n'

interface MovieDetailProps {
  movie: Movie
  onBack: () => void
  onDelete: () => void
  onSave: (movie: Movie) => Promise<void>
  onApplyFilter: (type: 'genre' | 'actor', value: string) => void
}

interface MovieFormState {
  title: string
  original_title: string
  year: string
  director: string
  runtime: string
  rating: string
  language: string
  imdb_id: string
  wikidata_id: string
  cover_url: string
  bluray_photo_url: string
  genres: string
  cast_members: string
  description: string
}

function createFormState(movie: Movie): MovieFormState {
  return {
    title: movie.title || '',
    original_title: movie.original_title || '',
    year: movie.year?.toString() || '',
    director: movie.director || '',
    runtime: movie.runtime?.toString() || '',
    rating: movie.rating?.toString() || '',
    language: movie.language || '',
    imdb_id: movie.imdb_id || '',
    wikidata_id: movie.wikidata_id || '',
    cover_url: movie.cover_url || '',
    bluray_photo_url: movie.bluray_photo_url || '',
    genres: (movie.genres || []).join(', '),
    cast_members: (movie.cast_members || []).join(', '),
    description: movie.description || '',
  }
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseStringArray(value: string): string[] | undefined {
  const arr = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return arr.length > 0 ? arr : undefined
}

function toNullable(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

function buildTmdbSearchUrl(movie: Movie): string {
  const query = movie.title.trim()
  return `https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`
}

export function MovieDetail({ movie, onBack, onDelete, onSave, onApplyFilter }: MovieDetailProps) {
  const { language, t } = useI18n()
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState<MovieFormState>(() => createFormState(movie))

  useEffect(() => {
    setForm(createFormState(movie))
    setSaveError(null)
    setIsSaving(false)
    setIsEditing(false)
  }, [movie])

  const previewCoverUrl = useMemo(() => {
    const url = form.cover_url.trim()
    return url && !url.startsWith('data:') ? url : undefined
  }, [form.cover_url])

  const updateField = (field: keyof MovieFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!movie.id) {
      setSaveError(t('movie.errorMissingId'))
      return
    }
    if (!form.title.trim()) {
      setSaveError(t('movie.errorEmptyTitle'))
      return
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      await onSave({
        ...movie,
        title: form.title.trim(),
        original_title: toNullable(form.original_title),
        year: parseOptionalNumber(form.year),
        director: toNullable(form.director),
        runtime: parseOptionalNumber(form.runtime),
        rating: parseOptionalNumber(form.rating),
        language: toNullable(form.language),
        imdb_id: toNullable(form.imdb_id),
        wikidata_id: toNullable(form.wikidata_id),
        cover_url: toNullable(form.cover_url),
        bluray_photo_url: toNullable(form.bluray_photo_url),
        genres: parseStringArray(form.genres),
        cast_members: parseStringArray(form.cast_members),
        description: toNullable(form.description),
      })
      setIsEditing(false)
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const cancelEdit = () => {
    setForm(createFormState(movie))
    setSaveError(null)
    setIsEditing(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-700 bg-slate-800 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm"
        >
          <span className="w-4 h-4"><ChevronLeft /></span>
          {t('movie.back')}
        </button>
        <h1 className="flex-1 text-xl font-bold text-white truncate">{movie.title}</h1>
        {isEditing ? (
          <>
            <button
              onClick={cancelEdit}
              disabled={isSaving}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              {t('movie.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-3 py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm transition-colors disabled:opacity-60"
            >
              {isSaving ? t('movie.saving') : t('movie.save')}
            </button>
          </>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="px-3 py-2 bg-brand-700 hover:bg-brand-600 text-white rounded-lg text-sm transition-colors"
          >
            {t('movie.edit')}
          </button>
        )}
        <button
          onClick={onDelete}
          className="flex items-center gap-2 px-3 py-2 bg-red-900/40 hover:bg-red-800/60 text-red-400 hover:text-red-300 rounded-lg text-sm transition-colors"
        >
          <span className="w-4 h-4"><Trash /></span>
          {t('movie.delete')}
        </button>
      </div>

      {/* Inhalt */}
      <div className="flex-1 overflow-y-auto p-6">
        {saveError && (
          <div className="max-w-4xl mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            {saveError}
          </div>
        )}
        <div className="max-w-4xl flex gap-8">
          {/* Cover */}
          <div className="w-48 shrink-0 space-y-3">
            {(isEditing ? previewCoverUrl : movie.cover_url && !movie.cover_url.startsWith('data:') ? movie.cover_url : undefined) ? (
              <img
                src={(isEditing ? previewCoverUrl : movie.cover_url) as string}
                alt={movie.title}
                className="w-full rounded-xl shadow-2xl"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="w-full aspect-[2/3] bg-slate-800 rounded-xl flex items-center justify-center text-slate-600">
                {t('movie.noCover')}
              </div>
            )}

          </div>

          {/* Details */}
          <div className="flex-1 space-y-6">
            {isEditing ? (
              <div className="space-y-4">
                <Field label={t('movie.fieldTitle')} value={form.title} onChange={(v) => updateField('title', v)} required />
                <Field label={t('movie.fieldOriginalTitle')} value={form.original_title} onChange={(v) => updateField('original_title', v)} />
                <div className="grid grid-cols-2 gap-4">
                  <Field label={t('movie.fieldYear')} value={form.year} onChange={(v) => updateField('year', v)} />
                  <Field label={t('movie.fieldDirector')} value={form.director} onChange={(v) => updateField('director', v)} />
                  <Field label={t('movie.fieldRuntime')} value={form.runtime} onChange={(v) => updateField('runtime', v)} />
                  <Field label={t('movie.fieldRating')} value={form.rating} onChange={(v) => updateField('rating', v)} />
                  <Field label={t('movie.fieldLanguage')} value={form.language} onChange={(v) => updateField('language', v)} />
                  <Field label={t('movie.fieldImdb')} value={form.imdb_id} onChange={(v) => updateField('imdb_id', v)} />
                  <Field label={t('movie.fieldTmdb')} value={form.wikidata_id} onChange={(v) => updateField('wikidata_id', v)} />
                </div>
                <Field label={t('movie.fieldCoverUrl')} value={form.cover_url} onChange={(v) => updateField('cover_url', v)} />
                <Field label={t('movie.fieldPhotoUrl')} value={form.bluray_photo_url} onChange={(v) => updateField('bluray_photo_url', v)} />
                <Field label={t('movie.fieldGenres')} value={form.genres} onChange={(v) => updateField('genres', v)} />
                <Field label={t('movie.fieldCast')} value={form.cast_members} onChange={(v) => updateField('cast_members', v)} />
                <Field label={t('movie.fieldDescription')} value={form.description} onChange={(v) => updateField('description', v)} multiline />
              </div>
            ) : (
              <>
                <div>
                  <h2 className="text-3xl font-bold text-white">{movie.title}</h2>
                  {movie.original_title && movie.original_title !== movie.title && (
                    <p className="text-slate-400 text-lg mt-0.5">{movie.original_title}</p>
                  )}
                </div>

                {/* Metadaten-Grid */}
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  <MetaRow label={t('movie.metaYear')} value={movie.year?.toString()} />
                  <MetaRow label={t('movie.metaDirector')} value={movie.director} />
                  <MetaRow label={t('movie.metaRuntime')} value={movie.runtime ? t('movie.metaRuntimeValue', { value: movie.runtime }) : undefined} />
                  <MetaRow label={t('movie.metaRating')} value={movie.rating ? t('movie.metaRatingValue', { value: movie.rating }) : undefined} />
                  <MetaRow label={t('movie.metaLanguage')} value={movie.language} />
                  <MetaRow label="IMDb-ID" value={movie.imdb_id} />
                </div>

                {/* Genres */}
                {movie.genres && movie.genres.length > 0 && (
                  <div>
                    <h3 className="text-slate-500 text-sm font-medium mb-2">{t('movie.metaGenres')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {movie.genres.map((g) => (
                        <button
                          key={g}
                          onClick={() => onApplyFilter('genre', g)}
                          className="px-3 py-1 bg-brand-900 text-brand-300 rounded-full text-sm border border-brand-800"
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Hauptdarsteller */}
                {movie.cast_members && movie.cast_members.length > 0 && (
                  <div>
                    <h3 className="text-slate-500 text-sm font-medium mb-2">{t('movie.metaCast')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {movie.cast_members.map((actor) => (
                        <button
                          key={actor}
                          onClick={() => onApplyFilter('actor', actor)}
                          className="px-3 py-1 bg-slate-800 text-slate-300 rounded-full text-sm border border-slate-700"
                        >
                          {actor}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Beschreibung */}
                {movie.description && (
                  <div>
                    <h3 className="text-slate-500 text-sm font-medium mb-2">{t('movie.metaDescription')}</h3>
                    <p className="text-slate-300 text-sm leading-relaxed">{movie.description}</p>
                  </div>
                )}

                <div>
                  <button
                    onClick={() => window.open(buildTmdbSearchUrl(movie), '_blank', 'noopener,noreferrer')}
                    className="px-3 py-2 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg text-sm transition-colors"
                  >
                    {t('movie.openTmdb')}
                  </button>
                  <img
                    src={tmdbLogo}
                    alt="TMDB"
                    className="mt-3 h-7 w-auto"
                  />
                  <p className="mt-3 max-w-2xl text-xs leading-relaxed text-slate-500">
                    {TMDB_ATTRIBUTION_NOTICE}
                  </p>
                </div>
              </>
            )}

            {/* Zeitstempel */}
            {movie.created_at && (
              <p className="text-slate-600 text-xs">
                {t('movie.added', { value: new Date(movie.created_at).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'long' }) })}
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

function Field({
  label,
  value,
  onChange,
  multiline = false,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  required?: boolean
}) {
  return (
    <label className="block">
      <div className="text-slate-500 text-xs font-medium mb-1.5">
        {label}{required ? ' *' : ''}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-brand-500"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:border-brand-500"
        />
      )}
    </label>
  )
}
