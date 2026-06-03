import React, { useRef, useState, useCallback, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import {
  searchMovieFuzzy,
  getMovieDetails,
  TMDB_ATTRIBUTION_NOTICE,
} from '@bluray-katalog/shared'
import type { TmdbMovie } from '@bluray-katalog/shared'
import { useI18n } from '../../lib/i18n'
import { TmdbLogo } from '../../lib/tmdb-logo'
import { saveStoredMovie } from '../../lib/movie-store'

type Step = 'camera' | 'processing' | 'search' | 'manual' | 'confirm' | 'saving' | 'done'

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
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function parseGeminiResponse(raw: string): string | null {
  const trimmed = raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim()

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    return cleanString(parsed.title) ?? null
  } catch {
    const plain = trimmed.replace(/^"|"$/g, '').trim()
    return plain || null
  }
}

async function recognizeTitleWithGemini(base64: string, geminiKey: string): Promise<string | null> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
            {
              text: 'You are analyzing a Blu-ray or DVD movie cover photo. Return STRICT JSON only (no markdown, no commentary) with this shape: {"title":""}. The title must be the main movie title from the cover. Do not include any other fields. If uncertain, return the best plausible main title only.',
            },
          ],
        }],
      }),
    }
  )
  const json = await resp.json()
  const rawText = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
  return parseGeminiResponse(rawText)
}

export default function ScanScreen() {
  const { t } = useI18n()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)

  const [hasGeminiKey, setHasGeminiKey] = useState<boolean | null>(null)
  const [step, setStep] = useState<Step>('camera')
  const [capturedUri, setCapturedUri] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [candidates, setCandidates] = useState<TmdbMovie[]>([])
  const [selectedMovie, setSelectedMovie] = useState<TmdbMovie | null>(null)
  const [manualForm, setManualForm] = useState<ManualMovieForm>({
    title: '', originalTitle: '', year: '', director: '',
    genres: '', cast: '', runtime: '', imdbId: '', description: '',
  })
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    SecureStore.getItemAsync('geminiKey').then((key) => {
      const hasKey = !!key?.trim()
      setHasGeminiKey(hasKey)
      if (!hasKey) setStep('search')
    })
  }, [])

  const parseCsv = (value: string): string[] =>
    value.split(',').map((entry) => entry.trim()).filter(Boolean)

  const parseOptionalNumber = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed.replace(',', '.'))
    return Number.isFinite(parsed) ? Math.round(parsed) : undefined
  }

  // ── Foto aufnehmen (nur mit Gemini Key) ────────────────────────────
  const takePicture = useCallback(async () => {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true })
      if (!photo?.uri) return
      setCapturedUri(photo.uri)
      setStep('processing')
      await runGeminiRecognition(photo.base64 ?? null, photo.uri)
    } catch (e) {
      setError(t('scan.cameraError', { message: (e as Error).message }))
      setStep('search')
    }
  }, [t])

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    })
    if (result.canceled) return
    const asset = result.assets[0]
    setCapturedUri(asset.uri)
    setStep('processing')
    await runGeminiRecognition(asset.base64 ?? null, asset.uri)
  }, [])

  // ── Gemini-Erkennung ────────────────────────────────────────────────
  const runGeminiRecognition = async (base64: string | null, _uri: string) => {
    try {
      setStatus(t('scan.ocrRunning'))
      const geminiKey = await SecureStore.getItemAsync('geminiKey')

      if (!geminiKey?.trim() || !base64) {
        setStep('search')
        return
      }

      const title = await recognizeTitleWithGemini(base64, geminiKey)
      if (title) {
        setSearchQuery(title)
        setStep('search')
        await doSearch(title)
      } else {
        setStep('search')
      }
    } catch (e) {
      setError(t('scan.ocrError', { message: (e as Error).message }))
      setStep('search')
    } finally {
      setStatus('')
    }
  }

  // ── TMDB-Suche ──────────────────────────────────────────────────────
  const doSearch = async (query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return

    try {
      setStatus(t('scan.searchRunning'))
      setError(null)
      setCandidates([])

      const results = await searchMovieFuzzy(trimmed)
      if (results.length > 0) {
        setCandidates(results)
      } else {
        setError(t('scan.searchNoneFound'))
      }
    } catch (e) {
      setError(t('scan.searchError', { message: (e as Error).message }))
    } finally {
      setStatus('')
    }
  }

  // ── Film auswählen: Details nachladen ──────────────────────────────
  const selectMovie = async (movie: TmdbMovie) => {
    try {
      setStatus(t('scan.fetchDetails'))
      const details = await getMovieDetails(movie.tmdbId)
      setSelectedMovie(details ?? movie)
    } catch {
      setSelectedMovie(movie)
    } finally {
      setStatus('')
      setStep('confirm')
    }
  }

  const startManualSearch = useCallback(() => {
    setCapturedUri(null)
    setSearchQuery('')
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('search')
  }, [])

  const backToCamera = useCallback(() => {
    setCapturedUri(null)
    setSearchQuery('')
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('camera')
  }, [])

  const openManualEntry = useCallback(() => {
    setManualForm({
      title: searchQuery.trim(),
      originalTitle: '', year: '', director: '',
      genres: '', cast: '', runtime: '', imdbId: '', description: '',
    })
    setError(null)
    setStep('manual')
  }, [searchQuery])

  const confirmManualEntry = useCallback(() => {
    const title = manualForm.title.trim()
    if (!title) {
      setError(t('scan.manualTitleRequired'))
      return
    }
    const manualId = `manual:${Date.now()}`
    const movie: TmdbMovie = {
      tmdbId: manualId,
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
    setSelectedMovie(movie)
    setError(null)
    setStep('confirm')
  }, [manualForm, t])

  // ── Speichern ───────────────────────────────────────────────────────
  const saveSelectedMovie = async () => {
    if (!selectedMovie) return
    setStep('saving')
    try {
      const isManual = selectedMovie.tmdbId.startsWith('manual:')

      setStatus(t('scan.saving'))
      await saveStoredMovie({
        title: selectedMovie.title,
        original_title: selectedMovie.originalTitle,
        year: selectedMovie.year,
        genres: selectedMovie.genres,
        cast_members: selectedMovie.cast,
        director: selectedMovie.director,
        description: selectedMovie.description,
        cover_url: selectedMovie.coverUrl,
        wikidata_id: isManual ? undefined : selectedMovie.tmdbId,
        imdb_id: selectedMovie.imdbId,
        runtime: selectedMovie.runtime,
      })
      setStep('done')
    } catch (e) {
      setError(t('scan.saveError', { message: (e as Error).message }))
      setStep('confirm')
    } finally {
      setStatus('')
    }
  }

  const reset = () => {
    setCapturedUri(null)
    setSearchQuery('')
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep(hasGeminiKey ? 'camera' : 'search')
  }

  if (step === 'camera') {
    if (hasGeminiKey === null) {
      return <View style={styles.center}><ActivityIndicator color="#6366f1" /></View>
    }

    if (!permission?.granted) {
      return (
        <View style={styles.center}>
          <Text style={styles.text}>{t('scan.permissionRequired')}</Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>{t('scan.grantPermission')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={pickFromGallery}>
            <Text style={styles.btnText}>{t('scan.pickGallery')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={startManualSearch}>
            <Text style={styles.btnText}>{t('scan.enterTitleManually')}</Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          <View style={styles.overlay}>
            <View style={styles.frame} />
            <Text style={styles.hint}>{t('scan.frameHint')}</Text>
          </View>
        </CameraView>
        <View style={styles.cameraControls}>
          <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
            <Text style={styles.galleryBtnText}>📁 {t('scan.galleryShort')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.captureBtn} onPress={takePicture} />
          <TouchableOpacity style={styles.galleryBtn} onPress={startManualSearch}>
            <Text style={styles.galleryBtnText}>⌨️ {t('scan.titleShort')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Alle anderen Schritte ───────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {selectedMovie?.coverUrl && step === 'confirm' && (
        <Image source={{ uri: selectedMovie.coverUrl }} style={styles.preview} resizeMode="contain" />
      )}

      {status !== '' && (
        <View style={styles.statusRow}>
          <ActivityIndicator color="#6366f1" />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Kein Gemini Key: Hinweis + Suchfeld */}
      {step === 'search' && !hasGeminiKey && (
        <View style={styles.noKeyHint}>
          <Text style={styles.noKeyTitle}>🔍 {t('scan.noKeyTitle')}</Text>
          <Text style={styles.noKeyText}>{t('scan.noKeyHint')}</Text>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary, { marginTop: 4 }]}
            onPress={() => router.push('/settings')}
          >
            <Text style={styles.btnText}>{t('scan.noKeySettings')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {(step === 'search' || step === 'confirm') && (
        <View style={styles.searchSection}>
          {hasGeminiKey && (
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={backToCamera}
              disabled={!!status}
            >
              <Text style={styles.btnText}>{t('scan.backToCamera')}</Text>
            </TouchableOpacity>
          )}

          <TextInput
            style={styles.input}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => doSearch(searchQuery)}
            placeholder={t('scan.movieTitlePlaceholder')}
            placeholderTextColor="#64748b"
            returnKeyType="search"
            autoFocus={!hasGeminiKey && step === 'search'}
          />
          <TouchableOpacity
            style={styles.btn}
            onPress={() => doSearch(searchQuery)}
            disabled={!!status}
          >
            <Text style={styles.btnText}>🔍 {t('scan.searchButton')}</Text>
          </TouchableOpacity>

          <View style={styles.tmdbAttributionSearch}>
            <TmdbLogo width={104} height={20} />
            <Text style={styles.tmdbAttributionText}>{TMDB_ATTRIBUTION_NOTICE}</Text>
          </View>
        </View>
      )}

      {step === 'search' && candidates.map((movie) => (
        <TouchableOpacity
          key={movie.tmdbId}
          style={styles.candidateCard}
          onPress={() => selectMovie(movie)}
        >
          {movie.coverUrl && (
            <Image source={{ uri: movie.coverUrl }} style={styles.candidateCover} resizeMode="cover" />
          )}
          <View style={styles.candidateInfo}>
            <Text style={styles.candidateTitle}>{movie.title}</Text>
            <Text style={styles.candidateMeta}>
              {[movie.year, movie.director].filter(Boolean).join(' · ')}
            </Text>
            {movie.genres.length > 0 && (
              <Text style={styles.candidateGenres}>{movie.genres.slice(0, 3).join(', ')}</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}

      {step === 'search' && (
        <TouchableOpacity
          style={[styles.candidateCard, styles.manualCard]}
          onPress={openManualEntry}
        >
          <View style={styles.candidateInfo}>
            <Text style={styles.candidateTitle}>✍️ {t('scan.manualCardTitle')}</Text>
            <Text style={styles.candidateMeta}>{t('scan.manualCardSubtitle')}</Text>
          </View>
        </TouchableOpacity>
      )}

      {step === 'manual' && (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{t('scan.manualFormTitle')}</Text>
          <TextInput style={styles.input} value={manualForm.title}
            onChangeText={(v) => setManualForm((p) => ({ ...p, title: v }))}
            placeholder={t('scan.manualFieldTitle')} placeholderTextColor="#64748b" />
          <TextInput style={styles.input} value={manualForm.originalTitle}
            onChangeText={(v) => setManualForm((p) => ({ ...p, originalTitle: v }))}
            placeholder={t('scan.manualFieldOriginalTitle')} placeholderTextColor="#64748b" />
          <TextInput style={styles.input} value={manualForm.year}
            onChangeText={(v) => setManualForm((p) => ({ ...p, year: v }))}
            placeholder={t('scan.manualFieldYear')} placeholderTextColor="#64748b"
            keyboardType="number-pad" />
          <TextInput style={styles.input} value={manualForm.director}
            onChangeText={(v) => setManualForm((p) => ({ ...p, director: v }))}
            placeholder={t('scan.manualFieldDirector')} placeholderTextColor="#64748b" />
          <TextInput style={styles.input} value={manualForm.genres}
            onChangeText={(v) => setManualForm((p) => ({ ...p, genres: v }))}
            placeholder={t('scan.manualFieldGenres')} placeholderTextColor="#64748b" />
          <TextInput style={styles.input} value={manualForm.cast}
            onChangeText={(v) => setManualForm((p) => ({ ...p, cast: v }))}
            placeholder={t('scan.manualFieldCast')} placeholderTextColor="#64748b" />
          <TextInput style={styles.input} value={manualForm.runtime}
            onChangeText={(v) => setManualForm((p) => ({ ...p, runtime: v }))}
            placeholder={t('scan.manualFieldRuntime')} placeholderTextColor="#64748b"
            keyboardType="number-pad" />
          <TextInput style={styles.input} value={manualForm.imdbId}
            onChangeText={(v) => setManualForm((p) => ({ ...p, imdbId: v }))}
            placeholder={t('scan.manualFieldImdb')} placeholderTextColor="#64748b" />
          <TextInput style={[styles.input, styles.inputMultiline]} value={manualForm.description}
            onChangeText={(v) => setManualForm((p) => ({ ...p, description: v }))}
            placeholder={t('scan.manualFieldDescription')} placeholderTextColor="#64748b"
            multiline />
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={confirmManualEntry}>
            <Text style={styles.btnText}>✓ {t('scan.manualCreateCandidate')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setStep('search')}>
            <Text style={styles.btnText}>{t('scan.back')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'confirm' && selectedMovie && (
        <View style={styles.confirmCard}>
          <TmdbLogo width={104} height={20} />
          <Text style={styles.confirmTitle}>{selectedMovie.title}</Text>
          {selectedMovie.year && (
            <Text style={styles.confirmMeta}>{t('scan.confirmYear', { value: selectedMovie.year })}</Text>
          )}
          {selectedMovie.director && (
            <Text style={styles.confirmMeta}>{t('scan.confirmDirector', { value: selectedMovie.director })}</Text>
          )}
          {selectedMovie.cast.length > 0 && (
            <Text style={styles.confirmMeta}>{t('scan.confirmCast', { value: selectedMovie.cast.slice(0, 3).join(', ') })}</Text>
          )}
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={saveSelectedMovie}>
            <Text style={styles.btnText}>✓ {t('scan.saveSelected')}</Text>
          </TouchableOpacity>
          <Text style={styles.tmdbAttributionText}>{TMDB_ATTRIBUTION_NOTICE}</Text>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setStep('search')}>
            <Text style={styles.btnText}>{t('scan.back')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneText}>✅ {t('scan.saved')}</Text>
          <Text style={styles.doneSub}>{selectedMovie?.title}</Text>
          <TouchableOpacity style={styles.btn} onPress={reset}>
            <Text style={styles.btnText}>{t('scan.scanNext')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => router.replace(`/?refreshKey=${Date.now()}`)}
          >
            <Text style={styles.btnText}>{t('scan.toLibrary')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scrollContent: { padding: 16, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  camera: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  frame: {
    width: 280, height: 180, borderWidth: 2,
    borderColor: '#6366f1', borderRadius: 8, opacity: 0.8,
  },
  hint: { color: '#fff', marginTop: 12, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 6 },
  cameraControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 24, backgroundColor: '#0f172a',
  },
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#6366f1', borderWidth: 4, borderColor: '#818cf8',
  },
  galleryBtn: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#334155', borderWidth: 2, borderColor: '#64748b', paddingHorizontal: 6,
  },
  galleryBtnText: { color: '#fff', fontSize: 11, fontWeight: '600', lineHeight: 13, textAlign: 'center' },
  preview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#1e293b' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#1e293b', borderRadius: 8 },
  statusText: { color: '#94a3b8' },
  errorText: { color: '#f87171', padding: 12, backgroundColor: '#450a0a', borderRadius: 8 },
  noKeyHint: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 16, gap: 8,
    borderWidth: 1, borderColor: '#334155',
  },
  noKeyTitle: { color: '#fff', fontWeight: '600', fontSize: 15 },
  noKeyText: { color: '#94a3b8', fontSize: 13, lineHeight: 19 },
  searchSection: { gap: 8 },
  tmdbAttributionSearch: {
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#334155',
    borderRadius: 10, padding: 12, gap: 8,
  },
  tmdbAttributionText: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },
  input: {
    backgroundColor: '#1e293b', color: '#fff', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: '#334155', fontSize: 15,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  btn: { backgroundColor: '#6366f1', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#334155' },
  btnGreen: { backgroundColor: '#16a34a' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  candidateCard: {
    backgroundColor: '#1e293b', borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: '#334155', flexDirection: 'row',
  },
  candidateCover: { width: 54, height: 80 },
  manualCard: { borderColor: '#6366f1', borderStyle: 'dashed' },
  candidateInfo: { gap: 3, flex: 1, padding: 12 },
  candidateTitle: { color: '#fff', fontWeight: '600', fontSize: 15 },
  candidateMeta: { color: '#94a3b8', fontSize: 13 },
  candidateGenres: { color: '#6366f1', fontSize: 12 },
  confirmCard: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 16, gap: 8,
    borderWidth: 1, borderColor: '#6366f1',
  },
  confirmTitle: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  confirmMeta: { color: '#94a3b8', fontSize: 13 },
  text: { color: '#94a3b8', marginBottom: 16, textAlign: 'center' },
  doneText: { fontSize: 24, marginBottom: 8 },
  doneSub: { color: '#fff', fontWeight: '600', fontSize: 16, marginBottom: 16, textAlign: 'center' },
})
