import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { getAllMovies, resolveWikimediaImageUrls } from '@bluray-katalog/shared'
import type { Movie } from '@bluray-katalog/shared'

const IMAGE_HEADERS = {
  'User-Agent': 'BluRay-Katalog/1.0',
  Referer: 'https://en.wikipedia.org/',
}

function CoverImage({ uri, title, style }: { uri: string; title: string; style: object }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <View style={[style, styles.coverPlaceholder]}>
        <Text style={styles.coverPlaceholderText}>🎬</Text>
        <Text style={styles.coverDebugText} numberOfLines={3}>{uri}</Text>
      </View>
    )
  }

  return (
    <Image
      source={{ uri, headers: IMAGE_HEADERS }}
      style={style}
      resizeMode="cover"
      onError={(event) => {
        console.warn('Cover image failed', { title, uri, error: event.nativeEvent.error })
        setFailed(true)
      }}
    />
  )
}

export default function LibraryScreen() {
  const [movies, setMovies] = useState<Movie[]>([])
  const [filtered, setFiltered] = useState<Movie[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMovies = useCallback(async () => {
    try {
      const url = await SecureStore.getItemAsync('supabaseUrl')
      const key =
        (await SecureStore.getItemAsync('supabaseKey')) ||
        (await SecureStore.getItemAsync('supabaseAnonKey'))
      if (!url || !key) {
        setError('Bitte Supabase-Zugangsdaten in den Einstellungen hinterlegen.')
        setLoading(false)
        return
      }
      const data = await getAllMovies(url, key)
      const coverUrls = await resolveWikimediaImageUrls(
        data.map((movie) => movie.cover_url).filter((coverUrl): coverUrl is string => Boolean(coverUrl))
      )
      const normalizedData = data.map((movie) => ({
        ...movie,
        cover_url: movie.cover_url ? (coverUrls.get(movie.cover_url) ?? movie.cover_url) : movie.cover_url,
      }))
      setMovies(normalizedData)
      setFiltered(normalizedData)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadMovies()
  }, [loadMovies])

  useFocusEffect(
    useCallback(() => {
      loadMovies()
    }, [loadMovies])
  )

  useEffect(() => {
    if (!query.trim()) {
      setFiltered(movies)
      return
    }
    const q = query.toLowerCase()
    setFiltered(
      movies.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.cast_members?.some((a) => a.toLowerCase().includes(q)) ||
          m.director?.toLowerCase().includes(q)
      )
    )
  }, [query, movies])

  const renderItem = ({ item }: { item: Movie }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/movie/${item.id}`)}
      activeOpacity={0.8}
    >
      {item.cover_url && !item.cover_url.startsWith('data:') ? (
        <CoverImage uri={item.cover_url} title={item.title} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderText}>🎬</Text>
        </View>
      )}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        {item.year && <Text style={styles.cardYear}>{item.year}</Text>}
        {item.genres && item.genres.length > 0 && (
          <Text style={styles.cardGenre} numberOfLines={1}>{item.genres[0]}</Text>
        )}
      </View>
    </TouchableOpacity>
  )

  return (
    <View style={styles.container}>
      {/* Suchleiste */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Suche..."
          placeholderTextColor="#64748b"
          value={query}
          onChangeText={setQuery}
          clearButtonMode="while-editing"
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => router.push('/settings')}
          >
            <Text style={styles.settingsBtnText}>Einstellungen öffnen</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id || item.title}
          renderItem={renderItem}
          numColumns={2}
          contentContainerStyle={styles.grid}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadMovies() }}
              tintColor="#6366f1"
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {movies.length === 0
                  ? 'Noch keine Filme. Scannen Sie ein Cover!'
                  : 'Keine Treffer'}
              </Text>
            </View>
          }
          ListHeaderComponent={
            <Text style={styles.count}>{filtered.length} Filme</Text>
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  searchBar: { padding: 12, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155' },
  searchInput: {
    backgroundColor: '#334155',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  grid: { padding: 8 },
  count: { color: '#64748b', fontSize: 12, paddingHorizontal: 8, paddingBottom: 8 },
  card: {
    flex: 1,
    margin: 6,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
    maxWidth: '48%',
  },
  cover: { width: '100%', aspectRatio: 2 / 3 },
  coverPlaceholder: { backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center' },
  coverPlaceholderText: { fontSize: 36 },
  coverDebugText: { color: '#94a3b8', fontSize: 9, paddingHorizontal: 6, paddingBottom: 6, textAlign: 'center' },
  cardInfo: { padding: 8 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', lineHeight: 16 },
  cardYear: { color: '#6366f1', fontSize: 11, marginTop: 2 },
  cardGenre: { color: '#64748b', fontSize: 11, marginTop: 1 },
  errorText: { color: '#f87171', textAlign: 'center', marginBottom: 16, lineHeight: 22 },
  settingsBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  settingsBtnText: { color: '#fff', fontWeight: '600' },
  emptyText: { color: '#64748b', textAlign: 'center' },
})
