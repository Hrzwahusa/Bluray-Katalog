import React, { useRef, useState, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { searchMovieFuzzy, getWikipediaDetails, searchMoviePoster } from '@bluray-katalog/shared'
import { saveMovie } from '@bluray-katalog/shared'
import type { WikidataMovie } from '@bluray-katalog/shared'
import { useI18n } from '../../lib/i18n'

const IMAGE_HEADERS = {
  'User-Agent': 'BluRay-Katalog/1.0',
  Referer: 'https://en.wikipedia.org/',
}

type Step = 'camera' | 'processing' | 'search' | 'confirm' | 'saving' | 'done'

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
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function cleanNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.').trim())
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return undefined
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => cleanString(entry))
    .filter((entry): entry is string => Boolean(entry))
}

function parseGeminiMovieGuess(raw: string): GeminiMovieGuess | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const jsonCandidate = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim()

  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>
    const guess: GeminiMovieGuess = {
      title: cleanString(parsed.title),
      originalTitle: cleanString(parsed.originalTitle),
      year: cleanNumber(parsed.year),
      director: cleanString(parsed.director),
      genres: cleanStringArray(parsed.genres),
      cast: cleanStringArray(parsed.cast),
      runtime: cleanNumber(parsed.runtime),
      imdbId: cleanString(parsed.imdbId),
      description: cleanString(parsed.description),
    }

    if (!guess.title) return null
    return guess
  } catch {
    const plainTitle = trimmed.replace(/^"|"$/g, '')
    return plainTitle ? { title: plainTitle } : null
  }
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

function isLikelyPosterImageUrl(url?: string): boolean {
  if (!url) return false
  const normalized = url.toLowerCase()
  if (isSvgDerivedImageUrl(normalized)) return false
  if (normalized.includes('/wikipedia/en/')) return true
  return /poster|cover|blu[-_ ]?ray|dvd/.test(normalized)
}

function shouldSearchPoster(coverUrl?: string): boolean {
  if (!coverUrl) return true
  return !isLikelyPosterImageUrl(coverUrl)
}

export default function ScanScreen() {
  const { t } = useI18n()

  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)

  const [step, setStep] = useState<Step>('camera')
  const [capturedUri, setCapturedUri] = useState<string | null>(null)
  const [ocrText, setOcrText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [candidates, setCandidates] = useState<WikidataMovie[]>([])
  const [selectedMovie, setSelectedMovie] = useState<WikidataMovie | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  // ── Foto aufnehmen ──────────────────────────────────────────────────
  const takePicture = useCallback(async () => {
    if (!cameraRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: true })
      if (!photo?.uri) return
      setCapturedUri(photo.uri)
      setStep('processing')
      await runGeminiOcr(photo.base64 ?? null, photo.uri)
    } catch (e) {
      setError(t('scan.cameraError', { message: (e as Error).message }))
      setStep('search')
    }
  }, [t])

  // ── Galerie auswählen ───────────────────────────────────────────────
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
    await runGeminiOcr(asset.base64 ?? null, asset.uri)
  }, [])

  // ── Gemini API Titel- und Metadaten-Erkennung ─────────────────────────
  const runGeminiOcr = async (base64: string | null, uri: string) => {
    try {
      setStatus(t('scan.ocrRunning'))
      const geminiKey = await SecureStore.getItemAsync('geminiKey')
      let guess: GeminiMovieGuess | null = null
      let title = ''

      if (geminiKey && base64) {
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
                    text: 'You are analyzing a Blu-ray or DVD movie cover photo. Return STRICT JSON only (no markdown, no commentary) with this shape: {"title":"","originalTitle":"","year":null,"director":"","genres":[],"cast":[],"runtime":null,"imdbId":"","description":""}. Rules: 1) title must be the main movie title from the cover. 2) Use null for unknown numbers and empty strings/arrays for unknown text fields. 3) Keep genres and cast short and relevant. 4) Do not invent highly specific facts; leave fields empty if uncertain.',
                  },
                ],
              }],
            }),
          }
        )
        const json = await resp.json()
        const rawText = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
        guess = parseGeminiMovieGuess(rawText)
        title = guess?.title ?? ''
      }

      setOcrText(title)
      setSearchQuery(title)
      setStep('search')
      if (title) {
        await doSearch(title, guess)
      }
    } catch (e) {
      setError(t('scan.ocrError', { message: (e as Error).message }))
      setStep('search')
    } finally {
      setStatus('')
    }
  }

  // ── Wikidata-Suche ──────────────────────────────────────────────────
  const doSearch = async (query: string, geminiGuess?: GeminiMovieGuess | null) => {
    if (!query.trim()) return
    try {
      setStatus(t('scan.searchRunning'))
      setError(null)
      setCandidates([])
      const results = await searchMovieFuzzy(query.trim())
      if (results.length > 0) {
        setCandidates(results)
        return
      }

      const fallback = geminiGuess ? buildGeminiFallbackCandidate(geminiGuess) : null
      if (fallback) {
        setCandidates([fallback])
        return
      }

      setError(t('scan.searchNoneFound'))
    } catch (e) {
      setError(t('scan.searchError', { message: (e as Error).message }))
    } finally {
      setStatus('')
    }
  }

  const startManualTitleSearch = useCallback(() => {
    setCapturedUri(null)
    setOcrText('')
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('search')
  }, [])

  const backToCamera = useCallback(() => {
    setCapturedUri(null)
    setOcrText('')
    setSearchQuery('')
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('camera')
  }, [])

  // ── Speichern ───────────────────────────────────────────────────────
  const saveSelectedMovie = async () => {
    if (!selectedMovie) return
    setStep('saving')
    try {
      const isGeminiFallback = selectedMovie.wikidataId.startsWith('gemini:')

      const supabaseUrl = await SecureStore.getItemAsync('supabaseUrl')
      const supabaseKey =
        (await SecureStore.getItemAsync('supabaseKey')) ||
        (await SecureStore.getItemAsync('supabaseAnonKey'))
      if (!supabaseUrl || !supabaseKey) {
        Alert.alert(t('alert.error'), t('scan.missingSupabase'))
        setStep('confirm')
        return
      }

      setStatus(t('scan.fetchWiki'))
      const wikiDetails = await getWikipediaDetails(selectedMovie.title, 'de')

      let posterUrl: string | undefined
      if (shouldSearchPoster(selectedMovie.coverUrl)) {
        setStatus(t('scan.searchPoster'))
        posterUrl = await searchMoviePoster(
          selectedMovie.title,
          selectedMovie.year,
          selectedMovie.originalTitle
        )
      }

      setStatus(t('scan.saving'))
      await saveMovie(
        {
          title: selectedMovie.title,
          original_title: selectedMovie.originalTitle,
          year: selectedMovie.year,
          genres: selectedMovie.genres,
          cast_members: selectedMovie.cast,
          director: selectedMovie.director,
          description: selectedMovie.description || wikiDetails.description,
          cover_url: selectedMovie.coverUrl || posterUrl || undefined,
          wikidata_id: isGeminiFallback ? undefined : selectedMovie.wikidataId,
          imdb_id: selectedMovie.imdbId,
          runtime: selectedMovie.runtime,
        },
        supabaseUrl,
        supabaseKey
      )
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
    setOcrText('')
    setSearchQuery('')
    setCandidates([])
    setSelectedMovie(null)
    setError(null)
    setStatus('')
    setStep('camera')
  }

  // ── Kamera-Schritt ──────────────────────────────────────────────────
  if (step === 'camera') {
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
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={startManualTitleSearch}>
            <Text style={styles.btnText}>{t('scan.enterTitleManually')}</Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back">
          {/* Rahmen-Hilfe */}
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
          <TouchableOpacity style={styles.galleryBtn} onPress={startManualTitleSearch}>
            <Text style={styles.galleryBtnText}>⌨️ {t('scan.titleShort')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Processing / Suche / Confirm / Done ────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Vorschaubild NUR wenn Wikidata-Cover vorhanden */}
      {selectedMovie?.coverUrl && step === 'confirm' && (
        <Image source={{ uri: selectedMovie.coverUrl, headers: IMAGE_HEADERS }} style={styles.preview} resizeMode="contain" />
      )}

      {/* Status / Loader */}
      {status !== '' && (
        <View style={styles.statusRow}>
          <ActivityIndicator color="#6366f1" />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      )}

      {/* Fehler */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Suchfeld (ab Step 'search') */}
      {(step === 'search' || step === 'confirm') && (
        <View style={styles.searchSection}>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={backToCamera}
            disabled={!!status}
          >
            <Text style={styles.btnText}>{t('scan.backToCamera')}</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => doSearch(searchQuery)}
            placeholder={t('scan.movieTitlePlaceholder')}
            placeholderTextColor="#64748b"
            returnKeyType="search"
          />
          <TouchableOpacity
            style={styles.btn}
            onPress={() => doSearch(searchQuery)}
            disabled={!!status}
          >
            <Text style={styles.btnText}>🔍 {t('scan.searchButton')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Suchergebnisse */}
      {step === 'search' && candidates.map((movie) => (
        <TouchableOpacity
          key={movie.wikidataId}
          style={styles.candidateCard}
          onPress={() => { setSelectedMovie(movie); setStep('confirm') }}
        >
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

      {/* Bestätigungs-Schritt */}
      {step === 'confirm' && selectedMovie && (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{selectedMovie.title}</Text>
          {selectedMovie.year && <Text style={styles.confirmMeta}>{t('scan.confirmYear', { value: selectedMovie.year })}</Text>}
          {selectedMovie.director && <Text style={styles.confirmMeta}>{t('scan.confirmDirector', { value: selectedMovie.director })}</Text>}
          {selectedMovie.cast.length > 0 && (
            <Text style={styles.confirmMeta}>{t('scan.confirmCast', { value: selectedMovie.cast.slice(0, 3).join(', ') })}</Text>
          )}
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={saveSelectedMovie}>
            <Text style={styles.btnText}>✓ {t('scan.saveSelected')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setStep('search')}>
            <Text style={styles.btnText}>{t('scan.back')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Fertig */}
      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneText}>✅ {t('scan.saved')}</Text>
          <Text style={styles.doneSub}>{selectedMovie?.title}</Text>
          <TouchableOpacity style={styles.btn} onPress={reset}>
            <Text style={styles.btnText}>{t('scan.scanNext')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => router.push('/')}
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
    width: 280,
    height: 180,
    borderWidth: 2,
    borderColor: '#6366f1',
    borderRadius: 8,
    opacity: 0.8,
  },
  hint: { color: '#fff', marginTop: 12, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, borderRadius: 6 },
  cameraControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 24,
    backgroundColor: '#0f172a',
  },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#6366f1',
    borderWidth: 4,
    borderColor: '#818cf8',
  },
  galleryBtn: { width: 72, alignItems: 'center' },
  galleryBtnText: { color: '#fff', fontSize: 12 },
  preview: { width: '100%', height: 200, borderRadius: 10, backgroundColor: '#1e293b' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#1e293b', borderRadius: 8 },
  statusText: { color: '#94a3b8' },
  errorText: { color: '#f87171', padding: 12, backgroundColor: '#450a0a', borderRadius: 8 },
  searchSection: { gap: 8 },
  input: {
    backgroundColor: '#1e293b',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 15,
  },
  btn: {
    backgroundColor: '#6366f1',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: '#334155' },
  btnGreen: { backgroundColor: '#16a34a' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  candidateCard: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  candidateInfo: { gap: 3 },
  candidateTitle: { color: '#fff', fontWeight: '600', fontSize: 15 },
  candidateMeta: { color: '#94a3b8', fontSize: 13 },
  candidateGenres: { color: '#6366f1', fontSize: 12 },
  confirmCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  confirmTitle: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  confirmMeta: { color: '#94a3b8', fontSize: 13 },
  text: { color: '#94a3b8', marginBottom: 16, textAlign: 'center' },
  doneText: { fontSize: 24, marginBottom: 8 },
  doneSub: { color: '#fff', fontWeight: '600', fontSize: 16, marginBottom: 16, textAlign: 'center' },
})

