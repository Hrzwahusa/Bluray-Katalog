import React, { useRef, useState, useCallback } from 'react'
import type { AppSettings } from '../App'
import type { WikidataMovie } from '@shared/types'

import { saveMovie } from '@shared/supabase'
import { Camera, X, Check, Loader, AlertCircle, Search } from '../components/Icons'

interface ScanProps {
  settings: AppSettings
  onSuccess: () => void
}

type Step = 'capture' | 'ocr' | 'select' | 'confirm' | 'saving' | 'done'

export function Scan({ settings, onSuccess }: ScanProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [step, setStep] = useState<Step>('capture')
  const [cameraActive, setCameraActive] = useState(false)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [candidates, setCandidates] = useState<WikidataMovie[]>([])
  const [selectedMovie, setSelectedMovie] = useState<WikidataMovie | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')

  // ── Kamera starten ──────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('navigator.mediaDevices nicht verfügbar (kein HTTPS oder Electron-Kontext?)')
        return
      }

      // Verfügbare Geräte anzeigen
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((d) => d.kind === 'videoinput')
      console.log('[Kamera] Gefundene Video-Geräte:', videoDevices)
      if (videoDevices.length === 0) {
        setError('Kein Kameragerät gefunden.')
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
      setError(`Kamera-Fehler (${err.name}): ${err.message}`)
    }
  }, [])

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
      setStatusMessage('Texterkennung läuft (Tesseract OCR)...')
      const result = await window.api.recognizeText(ocrUrl)
      const cleanedText = extractTitleFromOcr(result.text)
      setOcrText(result.text)
      setSearchQuery(cleanedText)
      setStatusMessage('')
      setStep('select')

      // Automatisch suchen
      if (cleanedText) {
        await doSearch(cleanedText)
      }
    } catch (e) {
      setError(`OCR-Fehler: ${(e as Error).message}`)
      setStep('select')
    }
  }, [stopCamera])

  // ── Filmsuche ───────────────────────────────────────────────────────
  const doSearch = async (query: string) => {
    if (!query.trim()) return
    try {
      setStatusMessage('Suche in Wikidata...')
      setCandidates([])
      const results = await window.api.searchMovies(query.trim())
      setCandidates(results)
      if (results.length === 0) {
        setError('Keine Filme gefunden. Bitte Suchbegriff anpassen.')
      } else {
        setError(null)
      }
    } catch (e) {
      setError(`Suchfehler: ${(e as Error).message}`)
    } finally {
      setStatusMessage('')
    }
  }

  // ── Film bestätigen ─────────────────────────────────────────────────
  const confirmAndSave = async () => {
    if (!selectedMovie) return
    setStep('saving')
    setStatusMessage('Hole Wikipedia-Details...')

    try {
      // Zusätzliche Details von Wikipedia
      const wikiDetails = await window.api.getWikipediaDetails(selectedMovie.title, 'de')

      setStatusMessage('Suche Film-Poster...')
      const posterUrl = await window.api.searchMoviePoster(selectedMovie.title, selectedMovie.year, selectedMovie.originalTitle)

      setStatusMessage('Speichere in Datenbank...')
      await saveMovie(
        {
          title: selectedMovie.title,
          original_title: selectedMovie.originalTitle,
          year: selectedMovie.year,
          genres: selectedMovie.genres,
          cast_members: selectedMovie.cast,
          director: selectedMovie.director,
          description: selectedMovie.description || wikiDetails.description,
          cover_url: posterUrl || selectedMovie.coverUrl || capturedImage || undefined,
          wikidata_id: selectedMovie.wikidataId,
          imdb_id: selectedMovie.imdbId,
          runtime: selectedMovie.runtime,
          bluray_photo_url: capturedImage || undefined,
        },
        settings.supabaseUrl,
        settings.supabaseKey
      )

      setStep('done')
    } catch (e) {
      setError(`Fehler beim Speichern: ${(e as Error).message}`)
      setStep('confirm')
    }
  }

  // ── Neu starten ─────────────────────────────────────────────────────
  const reset = () => {
    setCapturedImage(null)
    setOcrText('')
    setSearchQuery('')
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatusMessage('')
    setStep('capture')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-slate-700 bg-slate-800 shrink-0">
        <h1 className="text-xl font-bold text-white">Cover scannen</h1>
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
                  <p className="text-sm">Kamera noch nicht aktiv</p>
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
                <button
                  onClick={startCamera}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors"
                >
                  <span className="w-5 h-5"><Camera /></span>
                  Kamera starten
                </button>
              ) : (
                <>
                  <button
                    onClick={stopCamera}
                    className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={capture}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors"
                  >
                    Foto aufnehmen
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
              {statusMessage || 'Wird verarbeitet...'}
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
                  alt="Cover-Foto"
                />
                <div className="flex-1 space-y-2">
                  <p className="text-slate-400 text-xs font-mono bg-slate-800 p-2 rounded max-h-20 overflow-y-auto">
                    OCR-Text: {ocrText || '(kein Text erkannt)'}
                  </p>
                </div>
              </div>
            )}

            {/* Suchfeld */}
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doSearch(searchQuery)}
                placeholder="Filmtitel suchen..."
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
                Suchen
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
                <p className="text-slate-400 text-sm">{candidates.length} Treffer – bitte den richtigen Film auswählen:</p>
                {candidates.map((movie) => (
                  <button
                    key={movie.wikidataId}
                    onClick={() => {
                      setSelectedMovie(movie)
                      setStep('confirm')
                    }}
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
                        {movie.director && <span>Regie: {movie.director}</span>}
                        {movie.runtime && <span>{movie.runtime} Min.</span>}
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
          </div>
        )}

        {/* Schritt: Bestätigung */}
        {step === 'confirm' && selectedMovie && (
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-lg font-semibold text-white">Film bestätigen</h2>
            <div className="bg-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex gap-6">
                {selectedMovie.coverUrl && (
                  <img
                    src={selectedMovie.coverUrl}
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
                    <InfoRow label="Jahr" value={selectedMovie.year?.toString()} />
                    <InfoRow label="Regie" value={selectedMovie.director} />
                    <InfoRow label="Laufzeit" value={selectedMovie.runtime ? `${selectedMovie.runtime} Min.` : undefined} />
                    <InfoRow label="Wikidata" value={selectedMovie.wikidataId} />
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
                      <span className="text-slate-500">Darsteller: </span>
                      {selectedMovie.cast.slice(0, 5).join(', ')}
                    </p>
                  )}
                </div>
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
                Zurück
              </button>
              <button
                onClick={confirmAndSave}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-700 hover:bg-green-600 text-white font-medium rounded-lg transition-colors"
              >
                <span className="w-4 h-4"><Check /></span>
                In Katalog speichern
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
              <h2 className="text-xl font-bold text-white mb-2">Film gespeichert!</h2>
              <p className="text-slate-400">
                <span className="text-white font-medium">{selectedMovie?.title}</span> wurde erfolgreich in Ihrem Katalog gespeichert.
              </p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={reset}
                className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Weiteres Cover scannen
              </button>
              <button
                onClick={onSuccess}
                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-medium rounded-lg transition-colors"
              >
                Zur Bibliothek
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
  const steps: { key: Step; label: string }[] = [
    { key: 'capture', label: 'Foto' },
    { key: 'ocr', label: 'OCR' },
    { key: 'select', label: 'Auswahl' },
    { key: 'confirm', label: 'Bestätigen' },
    { key: 'saving', label: 'Speichern' },
    { key: 'done', label: 'Fertig' },
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
  // Versucht den Filmtitel aus dem OCR-Text zu extrahieren
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60)
    // Zeilen entfernen die nur Zahlen oder Sonderzeichen enthalten
    .filter((l) => /[a-zA-ZäöüÄÖÜß]/.test(l))
    // Bekannte Blu-ray-Texte entfernen
    .filter(
      (l) =>
        !/(blu-ray|bluray|ultra hd|4k|1080p|dolby|dts|version|edition|extended|unrated)/i.test(l)
    )

  // Die längste Zeile als wahrscheinlichsten Titel nehmen
  if (lines.length === 0) return text.split('\n')[0]?.trim() || ''
  return lines.sort((a, b) => b.length - a.length)[0]
}
