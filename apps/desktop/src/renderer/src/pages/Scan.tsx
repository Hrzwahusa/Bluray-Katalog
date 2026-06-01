import React, { useRef, useState, useCallback, useEffect } from 'react'
import type { AppSettings } from '../App'
import type { WikidataMovie } from '@shared/types'
import { TMDB_ATTRIBUTION_NOTICE } from '@shared/wikidata'

import { Camera, X, Check, Loader, AlertCircle, Search } from '../components/Icons'
import tmdbLogo from '../assets/tmdb-logo.svg'
import { saveStoredMovie } from '../lib/movie-store'
import { useI18n } from '../i18n'

interface ScanProps {
  settings: AppSettings
  onSuccess: () => void
}

type Step = 'capture' | 'ocr' | 'select' | 'manual' | 'confirm' | 'saving' | 'done'

type ManualMovieForm = {
  title: string
  originalTitle: string
  year: string
  director: string
  genres: string
  cast: string
  runtime: string
  imdbId: string
  description: string
}

type GeminiMovieGuess = {
  title?: string
  originalTitle?: string
  year?: number
  director?: string
  genres?: string[]
  cast?: string[]
  runtime?: number
  imdbId?: string
  description?: string
  coverImageUrl?: string
  posterHints?: string[]
}

type CoverOption = {
  id: string
  label: string
  url: string
}

function buildGeminiFallbackCandidate(guess: GeminiMovieGuess): WikidataMovie | null {
  if (!guess.title) return null
  return {
    wikidataId: `gemini:${guess.title.toLowerCase().replace(/\s+/g, '-')}`,
    title: guess.title,
    originalTitle: guess.originalTitle,
    year: guess.year,
    genres: guess.genres ?? [],
    cast: guess.cast ?? [],
    director: guess.director,
    description: guess.description,
    imdbId: guess.imdbId,
    runtime: guess.runtime,
  }
}

function isSvgDerivedImageUrl(url?: string): boolean {
  if (!url) return false
  const normalized = url.toLowerCase()
  return normalized.endsWith('.svg') || normalized.includes('.svg?') || normalized.includes('.svg.')
}

function normalizeCoverUrl(url?: string): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  if (!trimmed) return undefined
  if (!/^https?:\/\//i.test(trimmed)) return undefined
  if (isSvgDerivedImageUrl(trimmed)) return undefined
  return trimmed
}

function dedupeCoverOptions(options: CoverOption[]): CoverOption[] {
  const seen = new Set<string>()
  const out: CoverOption[] = []
  for (const option of options) {
    const key = option.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(option)
  }
  return out
}

function normalizeOcrTitleCandidate(value: string): string {
  return value
    .replace(/^[\s\-–—:•·*_\[\]()+"'`]+/, '')
    .replace(/[\s\-–—:•·*_\[\]()+"'`]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function scoreTitleCandidate(value: string): number {
  const normalized = normalizeOcrTitleCandidate(value)
  if (!normalized) return Number.NEGATIVE_INFINITY

  const letters = (normalized.match(/[A-Za-zÄÖÜäöüß]/g) ?? []).length
  const words = normalized.split(/\s+/).filter(Boolean).length
  const noisePenalty = (normalized.match(/[^A-Za-zÄÖÜäöüß0-9\s:'\-–—&().]/g) ?? []).length * 3
  const digitPenalty = (normalized.match(/\d/g) ?? []).length * 2
  const badKeywordPenalty = /\b(blu-ray|bluray|ultra hd|4k|1080p|dolby|dts|edition|extended|unrated|special|collector|directors cut)\b/i.test(normalized)
    ? 35
    : 0

  return letters + words * 3 - digitPenalty - noisePenalty - badKeywordPenalty
}

function extractTitleCandidates(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeOcrTitleCandidate(line))
    .filter((line) => line.length > 2 && line.length < 64)
    .filter((line) => /[A-Za-zÄÖÜäöüß]/.test(line))
    .filter((line) => !/(blu-ray|bluray|ultra hd|4k|1080p|dolby|dts|version|edition|extended|unrated|special|collector)/i.test(line))

  const variants = new Set<string>()
  for (const line of lines) {
    variants.add(line)

    const beforeDash = line.split(/\s+[-–—]\s+/)[0]?.trim()
    if (beforeDash) variants.add(beforeDash)

    const beforePipe = line.split('|')[0]?.trim()
    if (beforePipe) variants.add(beforePipe)

    const beforeYear = line.replace(/\s*\(?((19|20)\d{2})\)?\s*$/, '').trim()
    if (beforeYear) variants.add(beforeYear)
  }

  return Array.from(variants)
    .map((candidate) => normalizeOcrTitleCandidate(candidate))
    .filter(Boolean)
    .sort((left, right) => scoreTitleCandidate(right) - scoreTitleCandidate(left))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    })
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export function Scan({ settings, onSuccess }: ScanProps) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('capture')
  const [cameraActive, setCameraActive] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [candidates, setCandidates] = useState<WikidataMovie[]>([])
  const [selectedMovie, setSelectedMovie] = useState<WikidataMovie | null>(null)
  const [geminiGuess, setGeminiGuess] = useState<GeminiMovieGuess | null>(null)
  const [coverOptions, setCoverOptions] = useState<CoverOption[]>([])
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string>('')
  const [loadingCoverOptions, setLoadingCoverOptions] = useState(false)
  const [manualForm, setManualForm] = useState<ManualMovieForm>({
    title: '',
    originalTitle: '',
    year: '',
    director: '',
    genres: '',
    cast: '',
    runtime: '',
    imdbId: '',
    description: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  const parseCsv = (value: string): string[] => value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const parseOptionalNumber = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed.replace(',', '.'))
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined
  }

  useEffect(() => {
    if (step !== 'select') return
    const id = setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 0)
    return () => clearTimeout(id)
  }, [step])

  // ── Kamera starten ──────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t('scan.errorMediaDevices'))
        return
      }

      // Verfügbare Geräte anzeigen
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((d) => d.kind === 'videoinput')
      console.log('[Kamera] Gefundene Video-Geräte:', videoDevices)
      if (videoDevices.length === 0) {
        setError(t('scan.errorNoCamera'))
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      console.log('[Kamera] Stream erhalten:', stream.getTracks())
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        console.log('[Kamera] Video läuft, Dimensionen:', videoRef.current.videoWidth, 'x', videoRef.current.videoHeight)
      }
      setCameraActive(true)
      setError(null)
    } catch (e) {
      const err = e as Error
      console.error('[Kamera] Fehler:', err)
      setError(t('scan.errorCamera', { name: err.name, message: err.message }))
    }
  }, [t])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraActive(false)
  }, [])

  // ── Foto aufnehmen ──────────────────────────────────────────────────
  const capture = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(videoRef.current, 0, 0)

    // Vorschaubild (Original für die UI)
    const previewUrl = canvas.toDataURL('image/jpeg', 0.9)
    setCapturedImage(previewUrl)
    stopCamera()
    setStep('ocr')

    // Vorverarbeitetes Bild für OCR: Graustufen + Kontrast
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = imgData.data
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      // Kontrast erhöhen (Faktor 1.8)
      const c = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128))
      d[i] = c; d[i + 1] = c; d[i + 2] = c
    }
    ctx.putImageData(imgData, 0, 0)
    // PNG für OCR (keine JPEG-Artefakte)
    const ocrUrl = canvas.toDataURL('image/png')

    // Texterkennung starten
    try {
      setStatusMessage(t('scan.statusRecognizing'))
      const result = await window.api.recognizeText(ocrUrl)
      const cleanedText = extractTitleFromOcr(result.text)
      setOcrText(result.text)
      setGeminiGuess(result.movieGuess ?? null)
      setSearchQuery(cleanedText)
      setStatusMessage('')
      setStep('select')
    } catch (e) {
      setError(`OCR-Fehler: ${(e as Error).message}`)
      setStep('select')
    }
  }, [stopCamera, t])

  // ── Filmsuche ───────────────────────────────────────────────────────
  const doSearch = async (query: string, geminiGuessFromCall?: GeminiMovieGuess | null) => {
    if (!query.trim()) return
    try {
      setStatusMessage(t('scan.statusSearching'))
      setCandidates([])
      const searchCandidates = extractTitleCandidates(query)
      if (searchCandidates.length === 0) searchCandidates.push(query.trim())

      for (const candidate of searchCandidates) {
        const results = await window.api.searchMovies(candidate, settings.language)
        if (results.length > 0) {
          setCandidates(results)
          setSearchQuery(candidate)
          setError(null)
          return
        }
      }

      const fallbackGuess = geminiGuessFromCall ?? geminiGuess
      const fallback = fallbackGuess ? buildGeminiFallbackCandidate(fallbackGuess) : null
      if (fallback) {
        setCandidates([fallback])
        setError(null)
        return
      }

      setError(t('scan.errorNoSearchResults'))
    } catch (e) {
      setError(`Suchfehler: ${(e as Error).message}`)
    } finally {
      setStatusMessage('')
    }
  }

  const startManualTitleSearch = useCallback(() => {
    if (cameraActive) stopCamera()
    setCapturedImage(null)
    setOcrText('')
    setGeminiGuess(null)
    setCandidates([])
    setSelectedMovie(null)
    setCoverOptions([])
    setSelectedCoverUrl('')
    setError(null)
    setStatusMessage('')
    setStep('select')
  }, [cameraActive, stopCamera])

  const openManualEntry = useCallback(() => {
    setManualForm({
      title: searchQuery.trim(),
      originalTitle: '',
      year: '',
      director: '',
      genres: '',
      cast: '',
      runtime: '',
      imdbId: '',
      description: '',
    })
    setError(null)
    setStep('manual')
  }, [searchQuery])

  const confirmManualEntry = useCallback(() => {
    const title = manualForm.title.trim()
    if (!title) {
      setError(t('scan.manualRequired'))
      return
    }

    const movie: WikidataMovie = {
      wikidataId: `manual:${Date.now()}`,
      title,
      originalTitle: manualForm.originalTitle.trim() || undefined,
      year: parseOptionalNumber(manualForm.year),
      director: manualForm.director.trim() || undefined,
      genres: parseCsv(manualForm.genres),
      cast: parseCsv(manualForm.cast),
      runtime: parseOptionalNumber(manualForm.runtime),
      imdbId: manualForm.imdbId.trim() || undefined,
      description: manualForm.description.trim() || undefined,
    }

    void openConfirmStep(movie)
  }, [manualForm])

  const openConfirmStep = async (movie: WikidataMovie) => {
    setSelectedMovie(movie)
    setCoverOptions([])
    setSelectedCoverUrl('')
    setLoadingCoverOptions(true)
    setError(null)
    setStep('confirm')

    try {
      const options: CoverOption[] = []
      const wikidataCover = normalizeCoverUrl(movie.coverUrl)
      if (wikidataCover) {
        options.push({ id: 'tmdb', label: t('scan.coverOptionTmdb'), url: wikidataCover })
      }

      const geminiCover = normalizeCoverUrl(geminiGuess?.coverImageUrl)
      if (geminiCover) {
        options.push({ id: 'gemini', label: t('scan.coverOptionGemini'), url: geminiCover })
      }

      const immediateOptions = dedupeCoverOptions(options)
      setCoverOptions(immediateOptions)
      setSelectedCoverUrl(immediateOptions[0]?.url ?? wikidataCover ?? '')

      setStatusMessage(t('scan.statusSearchingPoster'))
      const searchedPoster = await withTimeout(
        window.api.searchMoviePoster(movie.title, movie.year, movie.originalTitle),
        30000,
        t('scan.statusPosterTimeout')
      )
      const posterCover = normalizeCoverUrl(searchedPoster)
      if (posterCover) {
        options.push({ id: 'poster-search', label: t('scan.coverOptionPoster'), url: posterCover })
      }

      const uniqueOptions = dedupeCoverOptions(options)
      setCoverOptions(uniqueOptions)
      setSelectedCoverUrl(uniqueOptions[0]?.url ?? wikidataCover ?? '')
    } catch {
      const fallbackCover = normalizeCoverUrl(movie.coverUrl) ?? ''
      setCoverOptions(fallbackCover ? [{ id: 'fallback', label: t('scan.coverOptionFallback'), url: fallbackCover }] : [])
      setSelectedCoverUrl(fallbackCover)
    } finally {
      setStatusMessage('')
      setLoadingCoverOptions(false)
    }
  }

  // ── Film bestätigen ─────────────────────────────────────────────────
  const confirmAndSave = async () => {
    if (!selectedMovie) return
    setStep('saving')
    setStatusMessage(t('scan.statusLoadingDetails'))

    try {
      const isLocalCandidate = selectedMovie.wikidataId.startsWith('gemini:') || selectedMovie.wikidataId.startsWith('manual:')

      // Zusätzliche Details von TMDB
      const wikiDetails = await window.api.getWikipediaDetails(selectedMovie.title, settings.language)

      setStatusMessage(t('scan.statusSaving'))
      await saveStoredMovie(
        {
          title: selectedMovie.title,
          original_title: selectedMovie.originalTitle,
          year: selectedMovie.year,
          genres: selectedMovie.genres,
          cast_members: selectedMovie.cast,
          director: selectedMovie.director,
          description: selectedMovie.description || wikiDetails.description,
          cover_url: selectedCoverUrl || selectedMovie.coverUrl || undefined,
          wikidata_id: isLocalCandidate ? undefined : selectedMovie.wikidataId,
          imdb_id: selectedMovie.imdbId,
          runtime: selectedMovie.runtime,
          bluray_photo_url: undefined,
        },
        settings
      )

      setStep('done')
    } catch (e) {
      setError(t('scan.errorSaving', { message: (e as Error).message }))
      setStep('confirm')
    }
  }

  // ── Neu starten ─────────────────────────────────────────────────────
  const reset = () => {
    setCapturedImage(null)
    setOcrText('')
    setGeminiGuess(null)
    setSearchQuery('')
    setCandidates([])
    setSelectedMovie(null)
    setCoverOptions([])
    setSelectedCoverUrl('')
    setError(null)
    setStatusMessage('')
    setStep('capture')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-700 bg-slate-800 shrink-0">
        <h1 className="text-xl font-bold text-white">{t('scan.title')}</h1>
        <StepIndicator current={step} />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Schritt: Kamera */}
        {step === 'capture' && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="relative bg-slate-800 rounded-xl overflow-hidden aspect-video border-2 border-dashed border-slate-600">
              {/* Video immer im DOM – srcObject kann nur gesetzt werden wenn Element existiert */}
              <video
                ref={videoRef}
                className={`w-full h-full object-cover ${cameraActive ? '' : 'hidden'}`}
                autoPlay
                playsInline
                muted
              />
              {/* Rahmen-Hilfe */}
              {cameraActive && (
                <div className="absolute inset-8 border-2 border-brand-400 rounded-lg opacity-60 pointer-events-none">
                  <div className="absolute -top-px left-4 right-4 h-0.5 bg-brand-400" />
                  <div className="absolute -bottom-px left-4 right-4 h-0.5 bg-brand-400" />
                </div>
              )}
              {!cameraActive && (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
                  <div className="w-16 h-16"><Camera /></div>
                  <p className="text-sm">{t('scan.cameraInactive')}</p>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
                <span className="w-4 h-4 shrink-0"><AlertCircle /></span>
                {error}
              </div>
            )}

            <div className="flex gap-3">
              {!cameraActive ? (
                <>
                  <button
                    onClick={startCamera}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors"
                  >
                    <span className="w-5 h-5"><Camera /></span>
                    {t('scan.startCamera')}
                  </button>
                  <button
                    onClick={startManualTitleSearch}
                    className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                  >
                    {t('scan.enterTitleManually')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={stopCamera}
                    className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                  >
                    {t('scan.back')}
                  </button>
                  <button
                    onClick={capture}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors"
                  >
                    {t('scan.capture')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Schritt: OCR läuft */}
        {step === 'ocr' && (
          <div className="max-w-2xl mx-auto">
            {capturedImage && (
              <img src={capturedImage} className="w-full rounded-xl mb-4 max-h-64 object-contain bg-black" alt="Aufgenommenes Cover" />
            )}
            <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg text-slate-300">
              <span className="w-5 h-5 text-brand-400"><Loader /></span>
              {statusMessage || t('scan.processing')}
            </div>
          </div>
        )}

        {/* Schritt: Film auswählen */}
        {step === 'select' && (
          <div className="max-w-3xl mx-auto space-y-4">
            {capturedImage && (
              <div className="flex gap-4">
                <img
                  src={capturedImage}
                  className="w-32 rounded-lg object-cover shrink-0 bg-black"
                  alt={t('scan.coverPhoto')}
                />
                <div className="flex-1 space-y-2">
                  <p className="text-slate-400 text-xs font-mono bg-slate-800 p-2 rounded max-h-20 overflow-y-auto">
                    {t('scan.ocrText', { value: ocrText || t('scan.ocrNoText') })}
                  </p>
                </div>
              </div>
            )}

            {/* Suchfeld */}
            <div className="flex gap-2 no-drag">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSearch(searchQuery)}
                placeholder={t('scan.searchPlaceholder')}
                className="flex-1 px-4 py-2.5 bg-slate-700 text-white placeholder-slate-400 rounded-lg border border-slate-600 focus:border-brand-500 focus:outline-none"
              />
              <button
                onClick={() => doSearch(searchQuery)}
                disabled={!!statusMessage}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors disabled:opacity-60"
              >
                {statusMessage ? (
                  <span className="w-4 h-4"><Loader /></span>
                ) : (
                  <span className="w-4 h-4"><Search /></span>
                )}
                {t('scan.search')}
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Ergebnisliste */}
            {candidates.length > 0 && (
              <div className="space-y-2">
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                  <img src={tmdbLogo} alt="TMDB" className="h-6 w-auto" />
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">{TMDB_ATTRIBUTION_NOTICE}</p>
                </div>
                <p className="text-slate-400 text-sm">{t('scan.results', { count: candidates.length })}</p>
                {candidates.map((movie) => (
                  <button
                    key={movie.wikidataId}
                    onClick={() => { void openConfirmStep(movie) }}
                    className="w-full flex items-center gap-4 p-4 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 hover:border-brand-500 transition-all text-left"
                  >
                    {movie.coverUrl ? (
                      <img
                        src={movie.coverUrl}
                        alt={movie.title}
                        className="w-12 h-16 object-cover rounded shrink-0 bg-slate-700"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <div className="w-12 h-16 bg-slate-700 rounded shrink-0 flex items-center justify-center">
                        <span className="text-slate-500 text-xs">?</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white truncate">{movie.title}</div>
                      {movie.originalTitle && movie.originalTitle !== movie.title && (
                        <div className="text-slate-400 text-sm truncate">{movie.originalTitle}</div>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        {movie.year && <span>{movie.year}</span>}
                        {movie.director && <span>{t('scan.director', { value: movie.director })}</span>}
                        {movie.runtime && <span>{t('scan.runtime', { value: movie.runtime })}</span>}
                      </div>
                      {movie.genres.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {movie.genres.slice(0, 4).map((g) => (
                            <span key={g} className="px-2 py-0.5 bg-slate-700 rounded-full text-xs text-slate-300">
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={openManualEntry}
              className="w-full flex items-center gap-3 p-4 bg-slate-800/80 hover:bg-slate-700 rounded-xl border border-dashed border-brand-500 transition-colors text-left"
            >
              <span className="text-xl">✍️</span>
              <div>
                <div className="font-semibold text-white">{t('scan.manualTitle')}</div>
                <div className="text-slate-400 text-sm">{t('scan.manualSubtitle')}</div>
              </div>
            </button>
          </div>
        )}

        {step === 'manual' && (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-lg font-semibold text-white">{t('scan.manualHeading')}</h2>
            <div className="bg-slate-800 rounded-xl p-4 space-y-3 border border-slate-700">
              <input
                type="text"
                value={manualForm.title}
                onChange={(e) => setManualForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={t('scan.manualFieldTitle')}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
              />
              <input
                type="text"
                value={manualForm.originalTitle}
                onChange={(e) => setManualForm((prev) => ({ ...prev, originalTitle: e.target.value }))}
                placeholder={t('scan.manualFieldOriginalTitle')}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="number"
                  value={manualForm.year}
                  onChange={(e) => setManualForm((prev) => ({ ...prev, year: e.target.value }))}
                  placeholder={t('scan.manualFieldYear')}
                  className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={manualForm.director}
                  onChange={(e) => setManualForm((prev) => ({ ...prev, director: e.target.value }))}
                  placeholder={t('scan.manualFieldDirector')}
                  className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
                />
              </div>
              <input
                type="text"
                value={manualForm.genres}
                onChange={(e) => setManualForm((prev) => ({ ...prev, genres: e.target.value }))}
                placeholder={t('scan.manualFieldGenres')}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
              />
              <input
                type="text"
                value={manualForm.cast}
                onChange={(e) => setManualForm((prev) => ({ ...prev, cast: e.target.value }))}
                placeholder={t('scan.manualFieldCast')}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="number"
                  value={manualForm.runtime}
                  onChange={(e) => setManualForm((prev) => ({ ...prev, runtime: e.target.value }))}
                  placeholder={t('scan.manualFieldRuntime')}
                  className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={manualForm.imdbId}
                  onChange={(e) => setManualForm((prev) => ({ ...prev, imdbId: e.target.value }))}
                  placeholder={t('scan.manualFieldImdb')}
                  className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none"
                />
              </div>
              <textarea
                value={manualForm.description}
                onChange={(e) => setManualForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder={t('scan.manualFieldDescription')}
                rows={4}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded border border-slate-600 focus:border-brand-500 focus:outline-none resize-y"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setStep('select')}
                  className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  {t('scan.back')}
                </button>
                <button
                  onClick={confirmManualEntry}
                  className="flex-1 px-4 py-2.5 bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors"
                >
                  {t('scan.toConfirmation')}
                </button>
              </div>
            </div>
            {error && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
            )}
          </div>
        )}

        {/* Schritt: Bestätigung */}
        {step === 'confirm' && selectedMovie && (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-lg font-semibold text-white">{t('scan.confirmTitle')}</h2>
            <div className="bg-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex gap-6">
                {(selectedCoverUrl || selectedMovie.coverUrl) && (
                  <img
                    src={selectedCoverUrl || selectedMovie.coverUrl}
                    className="w-32 rounded-lg object-cover bg-black shrink-0 shadow-lg"
                    alt="Cover"
                  />
                )}
                <div className="flex-1 space-y-2">
                  <h3 className="text-xl font-bold text-white">{selectedMovie.title}</h3>
                  {selectedMovie.originalTitle && (
                    <p className="text-slate-400 text-sm">{selectedMovie.originalTitle}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <InfoRow label={t('scan.infoYear')} value={selectedMovie.year?.toString()} />
                    <InfoRow label={t('scan.infoDirector')} value={selectedMovie.director} />
                    <InfoRow label={t('scan.infoRuntime')} value={selectedMovie.runtime ? t('scan.runtime', { value: selectedMovie.runtime }) : undefined} />
                    <InfoRow label={t('scan.infoWikidata')} value={selectedMovie.wikidataId} />
                  </div>
                  {selectedMovie.genres.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {selectedMovie.genres.map((g) => (
                        <span key={g} className="px-2 py-0.5 bg-brand-900 text-brand-300 rounded-full text-xs">{g}</span>
                      ))}
                    </div>
                  )}
                  {selectedMovie.cast.length > 0 && (
                    <p className="text-slate-400 text-sm">
                      <span className="text-slate-500">{t('scan.cast')}</span>
                      {selectedMovie.cast.slice(0, 5).join(', ')}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-700 pt-4">
                <p className="text-sm text-slate-300">{t('scan.coverSelection')}</p>
                {loadingCoverOptions && (
                  <div className="flex items-center gap-2 text-slate-400 text-sm">
                    <span className="w-4 h-4"><Loader /></span>
                    {statusMessage || t('scan.moreCoverOptions')}
                  </div>
                )}

                {coverOptions.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {coverOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setSelectedCoverUrl(option.url)}
                        className={`text-left rounded-lg border p-2 transition-colors ${
                          selectedCoverUrl === option.url
                            ? 'border-brand-500 bg-slate-700'
                            : 'border-slate-600 bg-slate-900 hover:border-slate-500'
                        }`}
                      >
                        <img src={option.url} alt={option.label} className="w-full h-28 object-cover rounded" />
                        <p className="text-xs text-slate-300 mt-2 truncate">{option.label}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">{t('scan.noCoverOptions')}</p>
                )}
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep('select')}
                className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                {t('scan.back')}
              </button>
              <button
                onClick={confirmAndSave}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-700 hover:bg-green-600 text-white font-medium rounded-lg transition-colors"
              >
                <span className="w-4 h-4"><Check /></span>
                {t('scan.saveToCatalog')}
              </button>
            </div>
          </div>
        )}

        {/* Schritt: Speichern */}
        {step === 'saving' && (
          <div className="flex flex-col items-center justify-center h-40 gap-4">
            <div className="w-8 h-8 text-brand-400"><Loader /></div>
            <p className="text-slate-300">{statusMessage}</p>
          </div>
        )}

        {/* Schritt: Fertig */}
        {step === 'done' && (
          <div className="max-w-md mx-auto text-center space-y-6 pt-8">
            <div className="w-16 h-16 mx-auto text-green-400"><Check /></div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">{t('scan.savedTitle')}</h2>
              <p className="text-slate-400">
                {t('scan.savedMessage', { title: selectedMovie?.title ?? '' })}
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={reset}
                className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                {t('scan.scanNext')}
              </button>
              <button
                onClick={onSuccess}
                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors"
              >
                {t('scan.toLibrary')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <span className="text-slate-500">{label}: </span>
      <span className="text-slate-300">{value}</span>
    </div>
  )
}

function StepIndicator({ current }: { current: Step }) {
  const { t } = useI18n()
  const steps: { key: Step; label: string }[] = [
    { key: 'capture', label: t('scan.stepCapture') },
    { key: 'ocr', label: 'OCR' },
    { key: 'select', label: t('scan.stepSelect') },
    { key: 'manual', label: t('scan.stepManual') },
    { key: 'confirm', label: t('scan.stepConfirm') },
    { key: 'saving', label: t('scan.stepSaving') },
    { key: 'done', label: t('scan.stepDone') },
  ]
  const currentIndex = steps.findIndex((s) => s.key === current)

  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => (
        <React.Fragment key={step.key}>
          <div
            className={`flex items-center gap-1 text-xs px-2 py-1 rounded
              ${i === currentIndex ? 'bg-brand-600 text-white' : i < currentIndex ? 'text-green-400' : 'text-slate-600'}`}
          >
            {i < currentIndex ? '✓' : i + 1}. {step.label}
          </div>
          {i < steps.length - 1 && <div className="w-3 h-px bg-slate-700" />}
        </React.Fragment>
      ))}
    </div>
  )
}

function extractTitleFromOcr(text: string): string {
  return extractTitleCandidates(text)[0] ?? normalizeOcrTitleCandidate(text.split(/\r?\n/)[0] ?? '')
}
