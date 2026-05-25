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

const IMAGE_HEADERS = {
  'User-Agent': 'BluRay-Katalog/1.0',
  Referer: 'https://en.wikipedia.org/',
}

type Step = 'camera' | 'processing' | 'search' | 'confirm' | 'saving' | 'done'

export default function ScanScreen() {
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
      setError(`Kamerafehler: ${(e as Error).message}`)
      setStep('search')
    }
  }, [])

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

  // ── Gemini API Titelerkennung ─────────────────────────────────────────
  const runGeminiOcr = async (base64: string | null, uri: string) => {
    try {
      setStatus('Titelerkennung läuft...')
      const geminiKey = await SecureStore.getItemAsync('geminiKey')
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
                  { text: 'This is a photo of a Blu-ray or DVD movie cover. What is the exact movie title shown on the cover? Return ONLY the movie title, nothing else. No explanations, no quotes, no punctuation at the end. If you cannot determine a title, return an empty string.' },
                ],
              }],
            }),
          }
        )
        const json = await resp.json()
        title = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '')
      }

      setOcrText(title)
      setSearchQuery(title)
      setStep('search')
      if (title) await doSearch(title)
    } catch (e) {
      setError(`Erkennungsfehler: ${(e as Error).message}`)
      setStep('search')
    } finally {
      setStatus('')
    }
  }

  // ── Wikidata-Suche ──────────────────────────────────────────────────
  const doSearch = async (query: string) => {
    if (!query.trim()) return
    try {
      setStatus('Suche in Wikidata...')
      setError(null)
      setCandidates([])
      const results = await searchMovieFuzzy(query.trim())
      setCandidates(results)
      if (results.length === 0) setError('Keine Filme gefunden.')
    } catch (e) {
      setError(`Suchfehler: ${(e as Error).message}`)
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

  // ── Speichern ───────────────────────────────────────────────────────
  const saveSelectedMovie = async () => {
    if (!selectedMovie) return
    setStep('saving')
    try {
      const supabaseUrl = await SecureStore.getItemAsync('supabaseUrl')
      const supabaseKey =
        (await SecureStore.getItemAsync('supabaseKey')) ||
        (await SecureStore.getItemAsync('supabaseAnonKey'))
      if (!supabaseUrl || !supabaseKey) {
        Alert.alert('Fehler', 'Bitte Supabase-Zugangsdaten in den Einstellungen hinterlegen.')
        setStep('confirm')
        return
      }

      setStatus('Hole Wikipedia-Details...')
      const wikiDetails = await getWikipediaDetails(selectedMovie.title, 'de')

      setStatus('Suche Film-Poster...')
      const posterUrl = await searchMoviePoster(
        selectedMovie.title,
        selectedMovie.year,
        selectedMovie.originalTitle
      )

      setStatus('Speichere...')
      await saveMovie(
        {
          title: selectedMovie.title,
          original_title: selectedMovie.originalTitle,
          year: selectedMovie.year,
          genres: selectedMovie.genres,
          cast_members: selectedMovie.cast,
          director: selectedMovie.director,
          description: selectedMovie.description || wikiDetails.description,
          cover_url: posterUrl || selectedMovie.coverUrl || undefined,
          wikidata_id: selectedMovie.wikidataId,
          imdb_id: selectedMovie.imdbId,
          runtime: selectedMovie.runtime,
        },
        supabaseUrl,
        supabaseKey
      )
      setStep('done')
    } catch (e) {
      setError(`Fehler: ${(e as Error).message}`)
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
          <Text style={styles.text}>Kamera-Berechtigung erforderlich</Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Berechtigung erteilen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={pickFromGallery}>
            <Text style={styles.btnText}>Aus Galerie wählen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={startManualTitleSearch}>
            <Text style={styles.btnText}>Titel manuell eingeben</Text>
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
            <Text style={styles.hint}>Blu-ray Cover im Rahmen positionieren</Text>
          </View>
        </CameraView>
        <View style={styles.cameraControls}>
          <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
            <Text style={styles.galleryBtnText}>📁 Galerie</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.captureBtn} onPress={takePicture} />
          <TouchableOpacity style={styles.galleryBtn} onPress={startManualTitleSearch}>
            <Text style={styles.galleryBtnText}>⌨️ Titel</Text>
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
          <TextInput
            style={styles.input}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => doSearch(searchQuery)}
            placeholder="Filmtitel..."
            placeholderTextColor="#64748b"
            returnKeyType="search"
          />
          <TouchableOpacity
            style={styles.btn}
            onPress={() => doSearch(searchQuery)}
            disabled={!!status}
          >
            <Text style={styles.btnText}>🔍 Suchen</Text>
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
          {selectedMovie.year && <Text style={styles.confirmMeta}>Jahr: {selectedMovie.year}</Text>}
          {selectedMovie.director && <Text style={styles.confirmMeta}>Regie: {selectedMovie.director}</Text>}
          {selectedMovie.cast.length > 0 && (
            <Text style={styles.confirmMeta}>Darsteller: {selectedMovie.cast.slice(0, 3).join(', ')}</Text>
          )}
          <TouchableOpacity style={[styles.btn, styles.btnGreen]} onPress={saveSelectedMovie}>
            <Text style={styles.btnText}>✓ Speichern</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setStep('search')}>
            <Text style={styles.btnText}>Zurück</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Fertig */}
      {step === 'done' && (
        <View style={styles.center}>
          <Text style={styles.doneText}>✅ Film gespeichert!</Text>
          <Text style={styles.doneSub}>{selectedMovie?.title}</Text>
          <TouchableOpacity style={styles.btn} onPress={reset}>
            <Text style={styles.btnText}>Weiteres Cover scannen</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnSecondary]}
            onPress={() => router.push('/')}
          >
            <Text style={styles.btnText}>Zur Bibliothek</Text>
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

