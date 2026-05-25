import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { getAllMovies, deleteMovie, resolveWikimediaImageUrls } from '@bluray-katalog/shared'
import type { Movie } from '@bluray-katalog/shared'

const IMAGE_HEADERS = {
  'User-Agent': 'BluRay-Katalog/1.0',
  Referer: 'https://en.wikipedia.org/',
}

function CoverImage({ uri, title }: { uri: string; title: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <View style={[styles.cover, styles.coverPlaceholder]}>
        <Text style={{ fontSize: 48 }}>🎬</Text>
        <Text style={styles.coverDebugText} numberOfLines={4}>{uri}</Text>
      </View>
    )
  }

  return (
    <Image
      source={{ uri, headers: IMAGE_HEADERS }}
      style={styles.cover}
      resizeMode="contain"
      onError={(event) => {
        console.warn('Detail cover image failed', { title, uri, error: event.nativeEvent.error })
        setFailed(true)
      }}
    />
  )
}

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [movie, setMovie] = useState<Movie | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const url = await SecureStore.getItemAsync('supabaseUrl')
      const key =
        (await SecureStore.getItemAsync('supabaseKey')) ||
        (await SecureStore.getItemAsync('supabaseAnonKey'))
      if (!url || !key) return
      const all = await getAllMovies(url, key)
      const coverUrls = await resolveWikimediaImageUrls(
        all.map((entry) => entry.cover_url).filter((coverUrl): coverUrl is string => Boolean(coverUrl))
      )
      const normalizedMovies = all.map((entry) => ({
        ...entry,
        cover_url: entry.cover_url ? (coverUrls.get(entry.cover_url) ?? entry.cover_url) : entry.cover_url,
      }))
      setMovie(normalizedMovies.find((m) => m.id === id) || null)
      setLoading(false)
    }
    load()
  }, [id])

  const handleDelete = async () => {
    Alert.alert('Film löschen', `"${movie?.title}" wirklich löschen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          const url = await SecureStore.getItemAsync('supabaseUrl')
          const key =
            (await SecureStore.getItemAsync('supabaseKey')) ||
            (await SecureStore.getItemAsync('supabaseAnonKey'))
          if (!url || !key || !movie?.id) return
          await deleteMovie(movie.id, url, key)
          router.back()
        },
      },
    ])
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>
  if (!movie) return <View style={styles.center}><Text style={styles.text}>Film nicht gefunden.</Text></View>

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Cover */}
      {movie.cover_url ? (
        <CoverImage uri={movie.cover_url} title={movie.title} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={{ fontSize: 48 }}>🎬</Text>
        </View>
      )}

      {/* Titel */}
      <Text style={styles.title}>{movie.title}</Text>
      {movie.original_title && movie.original_title !== movie.title && (
        <Text style={styles.originalTitle}>{movie.original_title}</Text>
      )}

      {/* Metadaten */}
      <View style={styles.metaGrid}>
        {movie.year && <MetaItem label="Jahr" value={movie.year.toString()} />}
        {movie.director && <MetaItem label="Regie" value={movie.director} />}
        {movie.runtime && <MetaItem label="Laufzeit" value={`${movie.runtime} Min.`} />}
        {movie.rating && <MetaItem label="Bewertung" value={`${movie.rating}/10`} />}
      </View>

      {/* Genres */}
      {movie.genres && movie.genres.length > 0 && (
        <Section title="Genres">
          <View style={styles.tagRow}>
            {movie.genres.map((g) => (
              <View key={g} style={styles.tag}>
                <Text style={styles.tagText}>{g}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Darsteller */}
      {movie.cast_members && movie.cast_members.length > 0 && (
        <Section title="Hauptdarsteller">
          <View style={styles.tagRow}>
            {movie.cast_members.map((a) => (
              <View key={a} style={[styles.tag, styles.tagActor]}>
                <Text style={styles.tagText}>{a}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}

      {/* Beschreibung */}
      {movie.description && (
        <Section title="Beschreibung">
          <Text style={styles.description}>{movie.description}</Text>
        </Section>
      )}

      {/* Löschen */}
      <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
        <Text style={styles.deleteBtnText}>🗑 Film löschen</Text>
      </TouchableOpacity>
    </ScrollView>
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  cover: { width: '100%', height: 300, borderRadius: 12, backgroundColor: '#1e293b', marginBottom: 16 },
  coverPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  coverDebugText: { color: '#94a3b8', fontSize: 11, textAlign: 'center', paddingHorizontal: 12, marginTop: 8 },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold', lineHeight: 30 },
  originalTitle: { color: '#94a3b8', fontSize: 16, marginTop: 4 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  metaItem: { minWidth: '45%' },
  metaLabel: { color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { color: '#e2e8f0', fontSize: 14, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: '#312e81', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  tagActor: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  tagText: { color: '#a5b4fc', fontSize: 13 },
  description: { color: '#cbd5e1', lineHeight: 22, fontSize: 14 },
  deleteBtn: {
    marginTop: 32,
    backgroundColor: '#450a0a',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7f1d1d',
  },
  deleteBtnText: { color: '#fca5a5', fontWeight: '600' },
  text: { color: '#94a3b8' },
})
