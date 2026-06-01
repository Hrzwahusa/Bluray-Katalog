import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  Linking,
  Platform,
} from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import {
  resolveWikimediaImageUrls,
  TMDB_ATTRIBUTION_NOTICE,
} from '@bluray-katalog/shared'
import type { Movie } from '@bluray-katalog/shared'
import { useI18n } from '../../lib/i18n'
import { getCachedCoverUri } from '../../lib/cover-cache'
import { TmdbLogo } from '../../lib/tmdb-logo'
import { deleteStoredMovie, getCachedMovies, syncStoredMoviesNow, updateStoredMovie } from '../../lib/movie-store'

function CoverImage({ uri, title }: { uri: string; title: string }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [uri])

  if (failed) {
    return (
      <View style={[styles.cover, styles.coverPlaceholder]}>
        <Text style={{ fontSize: 48 }}>🎬</Text>
      </View>
    )
  }

  return (
    <Image
      source={{ uri }}
      style={styles.cover}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  )
}

async function resolveCoverUrlsSafely(urls: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(urls.filter(Boolean)))

  if (typeof resolveWikimediaImageUrls !== 'function') {
    return new Map(unique.map((url) => [url, url]))
  }

  try {
    return await resolveWikimediaImageUrls(unique)
  } catch {
    return new Map(unique.map((url) => [url, url]))
  }
}

async function hydrateMovieCover(entry: Movie | null, verifyAgainstRemote: boolean): Promise<Movie | null> {
  if (!entry?.cover_url) return entry

  const resolved = await resolveCoverUrlsSafely([entry.cover_url])
  const resolvedUrl = resolved.get(entry.cover_url) ?? entry.cover_url
  if (!/^https?:\/\//i.test(resolvedUrl)) {
    return {
      ...entry,
      cover_url: resolvedUrl,
    }
  }

  const localOrRemote = await getCachedCoverUri(resolvedUrl, entry.title || 'cover', {
    verifyAgainstRemote,
    maxRetries: 2,
  })

  return {
    ...entry,
    cover_url: localOrRemote,
  }
}

export default function MovieDetailScreen() {
  const { t } = useI18n()

  const { id } = useLocalSearchParams<{ id: string }>()
  const [movie, setMovie] = useState<Movie | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    original_title: '',
    year: '',
    director: '',
    runtime: '',
    rating: '',
    language: '',
    imdb_id: '',
    wikidata_id: '',
    cover_url: '',
    bluray_photo_url: '',
    genres: '',
    cast_members: '',
    description: '',
  })

  const setFormFromMovie = (entry: Movie) => {
    setForm({
      title: entry.title || '',
      original_title: entry.original_title || '',
      year: entry.year?.toString() || '',
      director: entry.director || '',
      runtime: entry.runtime?.toString() || '',
      rating: entry.rating?.toString() || '',
      language: entry.language || '',
      imdb_id: entry.imdb_id || '',
      wikidata_id: entry.wikidata_id || '',
      cover_url: entry.cover_url || '',
      bluray_photo_url: entry.bluray_photo_url || '',
      genres: (entry.genres || []).join(', '),
      cast_members: (entry.cast_members || []).join(', '),
      description: entry.description || '',
    })
  }

  const loadMovie = useCallback(async () => {
    try {
      const targetId = typeof id === 'string' ? id : ''
      const cached = await getCachedMovies()
      const foundCached = cached.find((entry) => String(entry.id ?? '') === targetId) || null
      const hydratedCached = await hydrateMovieCover(foundCached, true)
      setMovie(hydratedCached)
      if (hydratedCached) setFormFromMovie(hydratedCached)

      // Refresh in background; never block the detail screen on sync.
      syncStoredMoviesNow()
        .then(async (synced) => {
          const foundSynced = synced.find((entry) => String(entry.id ?? '') === targetId) || null
          const hydratedSynced = await hydrateMovieCover(foundSynced, true)
          if (hydratedSynced) {
            setMovie(hydratedSynced)
            setFormFromMovie(hydratedSynced)
          }
        })
        .catch(() => {
          // Keep cached details visible if sync fails.
        })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadMovie()
  }, [loadMovie])

  const parseOptionalNumber = (value: string): number | undefined => {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const parseList = (value: string): string[] | undefined => {
    const arr = value.split(',').map((entry) => entry.trim()).filter(Boolean)
    return arr.length ? arr : undefined
  }

  const toNullable = (value: string): string | undefined => {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  const handleDelete = async () => {
    Alert.alert(t('movie.deleteTitle'), t('movie.deleteConfirm', { title: movie?.title ?? '' }), [
      { text: t('movie.cancel'), style: 'cancel' },
      {
        text: t('movie.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!movie?.id) return
          await deleteStoredMovie(movie.id)
          router.replace(`/?refreshKey=${Date.now()}`)
        },
      },
    ])
  }

  const buildTmdbSearchUrl = (): string => {
    const query = movie?.title?.trim() || ''
    return `https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`
  }

  const handleOpenTmdb = async () => {
    const url = buildTmdbSearchUrl()
    try {
      const canOpen = await Linking.canOpenURL(url)
      if (!canOpen) {
        Alert.alert(t('alert.error'), t('movie.tmdbOpenError'))
        return
      }
      await Linking.openURL(url)
    } catch {
      Alert.alert(t('alert.error'), t('movie.tmdbOpenError'))
    }
  }

  const applyTagFilter = (type: 'genre' | 'actor', value: string) => {
    const encoded = encodeURIComponent(value)
    router.push(`/?filterType=${type}&filterValue=${encoded}`)
  }

  const handleSave = async () => {
    if (!movie?.id) return
    if (!form.title.trim()) {
      setError(t('movie.titleEmpty'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const updated = await updateStoredMovie(
        {
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
          genres: parseList(form.genres),
          cast_members: parseList(form.cast_members),
          description: toNullable(form.description),
        }
      )

      const normalized = await resolveWikimediaImageUrls(
        updated.cover_url ? [updated.cover_url] : []
      )
      const hydrated = {
        ...updated,
        cover_url: updated.cover_url ? (normalized.get(updated.cover_url) ?? updated.cover_url) : updated.cover_url,
      }
      setMovie(hydrated)
      setFormFromMovie(hydrated)
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>
  if (!movie) return <View style={styles.center}><Text style={styles.text}>{t('movie.notFound')}</Text></View>

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 24}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, editing && styles.contentEditing]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Cover */}
        {(editing ? form.cover_url : movie.cover_url) ? (
          <CoverImage uri={(editing ? form.cover_url : movie.cover_url) as string} title={movie.title} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={{ fontSize: 48 }}>🎬</Text>
          </View>
        )}

        {editing ? (
          <View style={{ gap: 10 }}>
          <EditField label={t('movie.titleField')} value={form.title} onChangeText={(value) => setForm((prev) => ({ ...prev, title: value }))} />
          <EditField label={t('movie.originalTitle')} value={form.original_title} onChangeText={(value) => setForm((prev) => ({ ...prev, original_title: value }))} />
          <EditField label={t('movie.year')} value={form.year} onChangeText={(value) => setForm((prev) => ({ ...prev, year: value }))} keyboardType="numeric" />
          <EditField label={t('movie.director')} value={form.director} onChangeText={(value) => setForm((prev) => ({ ...prev, director: value }))} />
          <EditField label={t('movie.runtimeMinutesLabel')} value={form.runtime} onChangeText={(value) => setForm((prev) => ({ ...prev, runtime: value }))} keyboardType="numeric" />
          <EditField label={t('movie.rating')} value={form.rating} onChangeText={(value) => setForm((prev) => ({ ...prev, rating: value }))} keyboardType="decimal-pad" />
          <EditField label={t('movie.language')} value={form.language} onChangeText={(value) => setForm((prev) => ({ ...prev, language: value }))} />
          <EditField label={t('movie.imdbId')} value={form.imdb_id} onChangeText={(value) => setForm((prev) => ({ ...prev, imdb_id: value }))} />
          <EditField label={t('movie.wikidataId')} value={form.wikidata_id} onChangeText={(value) => setForm((prev) => ({ ...prev, wikidata_id: value }))} />
          <EditField label={t('movie.coverUrl')} value={form.cover_url} onChangeText={(value) => setForm((prev) => ({ ...prev, cover_url: value }))} />
          <EditField label={t('movie.photoUrl')} value={form.bluray_photo_url} onChangeText={(value) => setForm((prev) => ({ ...prev, bluray_photo_url: value }))} />
          <EditField label={t('movie.genresCsv')} value={form.genres} onChangeText={(value) => setForm((prev) => ({ ...prev, genres: value }))} />
          <EditField label={t('movie.castCsv')} value={form.cast_members} onChangeText={(value) => setForm((prev) => ({ ...prev, cast_members: value }))} />
          <EditField label={t('movie.description')} value={form.description} onChangeText={(value) => setForm((prev) => ({ ...prev, description: value }))} multiline />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              disabled={saving}
              onPress={() => {
                setFormFromMovie(movie)
                setEditing(false)
                setError(null)
              }}
            >
              <Text style={styles.btnText}>{t('movie.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnSave]} disabled={saving} onPress={handleSave}>
              <Text style={styles.btnText}>{saving ? t('movie.saving') : t('movie.save')}</Text>
            </TouchableOpacity>
          </View>
          </View>
        ) : (
          <>
          {/* Titel */}
          <Text style={styles.title}>{movie.title}</Text>
          {movie.original_title && movie.original_title !== movie.title && (
            <Text style={styles.originalTitle}>{movie.original_title}</Text>
          )}

          {/* Metadaten */}
          <View style={styles.metaGrid}>
            {movie.year && <MetaItem label={t('movie.year')} value={movie.year.toString()} />}
            {movie.director && <MetaItem label={t('movie.director')} value={movie.director} />}
            {movie.runtime && <MetaItem label={t('movie.runtime')} value={t('movie.runtimeMinutes', { value: movie.runtime })} />}
            {movie.rating && <MetaItem label={t('movie.rating')} value={t('movie.ratingValue', { value: movie.rating })} />}
          </View>

          {/* Genres */}
          {movie.genres && movie.genres.length > 0 && (
            <Section title={t('movie.genres')}>
              <View style={styles.tagRow}>
                {movie.genres.map((g) => (
                  <TouchableOpacity key={g} style={styles.tag} onPress={() => applyTagFilter('genre', g)}>
                    <Text style={styles.tagText}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>
          )}

          {/* Darsteller */}
          {movie.cast_members && movie.cast_members.length > 0 && (
            <Section title={t('movie.cast')}>
              <View style={styles.tagRow}>
                {movie.cast_members.map((a) => (
                  <TouchableOpacity key={a} style={[styles.tag, styles.tagActor]} onPress={() => applyTagFilter('actor', a)}>
                    <Text style={styles.tagText}>{a}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Section>
          )}

          {/* Beschreibung */}
          {movie.description && (
            <Section title={t('movie.description')}>
              <Text style={styles.description}>{movie.description}</Text>
            </Section>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
            <TouchableOpacity style={[styles.btn, styles.btnTmdb]} onPress={handleOpenTmdb}>
              <Text style={styles.btnText}>{t('movie.openTmdb')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnEdit]} onPress={() => setEditing(true)}>
              <Text style={styles.btnText}>{t('movie.edit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.deleteBtn]} onPress={handleDelete}>
              <Text style={styles.deleteBtnText}>🗑 {t('movie.deleteMovie')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.attributionLogoWrap}>
            <TmdbLogo width={110} height={22} />
          </View>
          <Text style={styles.attributionText}>{TMDB_ATTRIBUTION_NOTICE}</Text>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function EditField({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = 'default',
}: {
  label: string
  value: string
  onChangeText: (value: string) => void
  multiline?: boolean
  keyboardType?: 'default' | 'numeric' | 'decimal-pad'
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.inputMultiline]}
        placeholderTextColor="#64748b"
      />
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 20 }}>
      <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Text>
      {children}
    </View>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
  contentEditing: { paddingBottom: 220 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: '#fca5a5', backgroundColor: '#450a0a', borderColor: '#7f1d1d', borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 10 },
  cover: { width: '100%', height: 300, borderRadius: 12, backgroundColor: '#1e293b', marginBottom: 16 },
  coverPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', lineHeight: 30 },
  originalTitle: { color: '#94a3b8', fontSize: 16, marginTop: 4 },
  fieldLabel: { color: '#64748b', fontSize: 12, marginBottom: 4 },
  input: {
    backgroundColor: '#1e293b',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 14,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  metaItem: { minWidth: '45%' },
  metaLabel: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { color: '#e2e8f0', fontSize: 14, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: '#312e81', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  tagActor: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  tagText: { color: '#a5b4fc', fontSize: 13 },
  description: { color: '#cbd5e1', lineHeight: 22, fontSize: 14 },
  btn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: '#334155' },
  btnSave: { backgroundColor: '#15803d' },
  btnEdit: { backgroundColor: '#4338ca' },
  btnText: { color: '#fff', fontWeight: '600' },
  deleteBtn: {
    backgroundColor: '#450a0a',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  btnTmdb: {
    backgroundColor: '#0e7490',
  },
  deleteBtnText: { color: '#fca5a5', fontWeight: '600' },
  text: { color: '#94a3b8' },
  attributionLogoWrap: { marginTop: 14 },
  attributionText: { color: '#64748b', fontSize: 11, lineHeight: 16, marginTop: 14 },
})
