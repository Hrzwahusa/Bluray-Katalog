import React, { useState, useEffect, useCallback, useRef } from 'react'
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
import { router, useLocalSearchParams } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { resolveWikimediaImageUrls } from '@bluray-katalog/shared'
import type { Movie } from '@bluray-katalog/shared'
import { useI18n } from '../../lib/i18n'
import { getCachedCoverUri, isLocalCachedCoverUri } from '../../lib/cover-cache'
import { getCachedMovies, subscribeStoredMoviesChanged, subscribeSyncStatus, syncStoredMoviesNow } from '../../lib/movie-store'

const LIBRARY_VIEW_MODE_KEY = 'libraryViewMode'
const ENABLE_LIBRARY_COVERS = true

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asIdString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return items.length > 0 ? items : undefined
}

function normalizeMovieForUi(movie: Movie): Movie {
  const title = asString((movie as unknown as Record<string, unknown>).title)?.trim() || 'Unbekannt'
  const director = asString((movie as unknown as Record<string, unknown>).director)?.trim()
  const coverUrl = asString((movie as unknown as Record<string, unknown>).cover_url)
  const genres = asStringArray((movie as unknown as Record<string, unknown>).genres)
  const castMembers = asStringArray((movie as unknown as Record<string, unknown>).cast_members)?.slice(0, 8)
  const yearValue = (movie as unknown as Record<string, unknown>).year
  const year = typeof yearValue === 'number' ? yearValue : undefined
  const id = asIdString((movie as unknown as Record<string, unknown>).id)
  const wikidataId = asString((movie as unknown as Record<string, unknown>).wikidata_id)
  const imdbId = asString((movie as unknown as Record<string, unknown>).imdb_id)
  const createdAt = asString((movie as unknown as Record<string, unknown>).created_at)
  const updatedAt = asString((movie as unknown as Record<string, unknown>).updated_at)

  return {
    id,
    title,
    year,
    genres,
    cast_members: castMembers,
    director,
    cover_url: coverUrl,
    wikidata_id: wikidataId,
    imdb_id: imdbId,
    created_at: createdAt,
    updated_at: updatedAt,
  }
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

async function normalizeMovieCoverUrls(
  movies: Movie[],
  cache: Map<string, string>,
  fileCache: Map<string, string>,
  options?: { verifyAgainstRemote?: boolean; maxRetries?: number; batchSize?: number }
): Promise<Movie[]> {
  const sourceUrls = Array.from(
    new Set(
      movies
        .map((entry) => entry.cover_url)
        .filter((coverUrl): coverUrl is string => typeof coverUrl === 'string' && coverUrl.length > 0)
    )
  )

  if (sourceUrls.length === 0) {
    return movies
  }

  const pendingUrls = sourceUrls.filter((coverUrl) => !cache.has(coverUrl))
  if (pendingUrls.length > 0) {
    const resolvedUrls = await resolveCoverUrlsSafely(pendingUrls)
    for (const sourceUrl of pendingUrls) {
      cache.set(sourceUrl, resolvedUrls.get(sourceUrl) ?? sourceUrl)
    }
  }

  const remoteTargets = new Map<string, string>()
  for (const entry of movies) {
    if (!entry.cover_url) continue
    const resolvedUrl = cache.get(entry.cover_url) ?? entry.cover_url
    if (!/^https?:\/\//i.test(resolvedUrl)) continue
    if (isLocalCachedCoverUri(fileCache.get(resolvedUrl) ?? '')) continue
    if (!remoteTargets.has(resolvedUrl)) {
      remoteTargets.set(resolvedUrl, entry.title || 'cover')
    }
  }

  const batchSize = Math.max(4, options?.batchSize ?? 10)
  const targetEntries = Array.from(remoteTargets.entries())
  for (let index = 0; index < targetEntries.length; index += batchSize) {
    const batch = targetEntries.slice(index, index + batchSize)
    await Promise.all(batch.map(async ([resolvedUrl, title]) => {
      const cachedLocalUri = await getCachedCoverUri(resolvedUrl, title, {
        verifyAgainstRemote: options?.verifyAgainstRemote === true,
        maxRetries: options?.maxRetries ?? 1,
      })

      if (isLocalCachedCoverUri(cachedLocalUri)) {
        fileCache.set(resolvedUrl, cachedLocalUri)
      } else {
        fileCache.delete(resolvedUrl)
      }
    }))
  }

  const normalizedMovies = movies.map((entry) => {
    if (!entry.cover_url) return entry

    const resolvedUrl = cache.get(entry.cover_url) ?? entry.cover_url
    if (!/^https?:\/\//i.test(resolvedUrl)) {
      return {
        ...entry,
        cover_url: resolvedUrl,
      }
    }

    return {
      ...entry,
      cover_url: fileCache.get(resolvedUrl) ?? resolvedUrl,
    }
  })

  return normalizedMovies
}

function countRemoteCoverUrls(movies: Movie[]): number {
  return movies.reduce((count, entry) => {
    if (entry.cover_url && /^https?:\/\//i.test(entry.cover_url)) {
      return count + 1
    }
    return count
  }, 0)
}

async function fillCoverCacheUntilComplete(
  movies: Movie[],
  resolvedCache: Map<string, string>,
  localFileCache: Map<string, string>,
  onProgress?: (movies: Movie[]) => void
): Promise<Movie[]> {
  let current = movies
  let previousRemoteCount = Number.MAX_SAFE_INTEGER

  for (let attempt = 0; attempt < 12; attempt += 1) {
    console.log('[library-cover-cache] round:start', {
      attempt: attempt + 1,
      remoteBefore: countRemoteCoverUrls(current),
      totalMovies: current.length,
      localCacheEntries: localFileCache.size,
    })

    current = await normalizeMovieCoverUrls(current, resolvedCache, localFileCache, {
      maxRetries: 2,
      batchSize: 10,
    })

    onProgress?.(current)

    const remoteCount = countRemoteCoverUrls(current)
    console.log('[library-cover-cache] round:end', {
      attempt: attempt + 1,
      remoteAfter: remoteCount,
      localCacheEntries: localFileCache.size,
    })

    if (remoteCount === 0) {
      console.log('[library-cover-cache] complete', { attempt: attempt + 1, totalMovies: current.length })
      break
    }

    // Keep retrying in background so late-network responses eventually fill the cache.
    if (remoteCount >= previousRemoteCount) {
      await new Promise((resolve) => setTimeout(resolve, 700))
    } else {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    previousRemoteCount = remoteCount
  }

  return current
}

function CoverImage({ uri, title, style }: { uri: string; title: string; style: object }) {
  const [failed, setFailed] = useState(false)
  const [displayUri, setDisplayUri] = useState(uri)
  const [didRetryResolve, setDidRetryResolve] = useState(false)

  useEffect(() => {
    // FlatList reuses cells; reset image state whenever a different URI is rendered.
    setFailed(false)
    setDisplayUri(uri)
    setDidRetryResolve(false)
  }, [uri])

  const handleError = useCallback(() => {
    console.warn('[library-cover-image] error', {
      title,
      uri,
      displayUri,
      didRetryResolve,
      isLocalUri: isLocalCachedCoverUri(displayUri),
    })

    if (didRetryResolve || !uri) {
      setFailed(true)
      return
    }

    setDidRetryResolve(true)

    void resolveCoverUrlsSafely([uri])
      .then((resolved) => {
        const retryUri = resolved.get(uri)
        if (retryUri && retryUri !== displayUri) {
          setDisplayUri(retryUri)
          setFailed(false)
          return
        }
        setFailed(true)
      })
      .catch(() => {
        setFailed(true)
      })
  }, [didRetryResolve, uri, displayUri])

  if (failed) {
    return (
      <View style={[style, styles.coverPlaceholder]}>
        <Text style={styles.coverPlaceholderText}>🎬</Text>
      </View>
    )
  }

  return (
    <Image
      source={{ uri: displayUri }}
      style={style}
      resizeMode="cover"
      onError={handleError}
    />
  )
}

export default function LibraryScreen() {
  const { t } = useI18n()
  const { filterType, filterValue, refreshKey } = useLocalSearchParams<{ filterType?: string; filterValue?: string; refreshKey?: string }>()

  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery')
  const [genreFilter, setGenreFilter] = useState<string>('__all__')
  const [genreMenuOpen, setGenreMenuOpen] = useState(false)
  const [movies, setMovies] = useState<Movie[]>([])
  const [filtered, setFiltered] = useState<Movie[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastAppliedFilterRef = useRef('')
  const syncInFlightRef = useRef(false)
  const lastSyncAtRef = useRef(0)
  const didInitialLoadRef = useRef(false)
  const resolvedCoverUrlCacheRef = useRef<Map<string, string>>(new Map())
  const localCoverFileCacheRef = useRef<Map<string, string>>(new Map())

  const allGenres = [
    { value: '__all__', label: t('library.genreAll') },
    ...Array.from(new Set(movies.flatMap((m) => m.genres || []))).sort().map((genre) => ({ value: genre, label: genre })),
  ]

  useEffect(() => {
    let mounted = true
    const loadViewMode = async () => {
      const stored = await SecureStore.getItemAsync(LIBRARY_VIEW_MODE_KEY)
      if (!mounted) return
      if (stored === 'gallery' || stored === 'list') {
        setViewMode(stored)
      }
    }
    loadViewMode()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    SecureStore.setItemAsync(LIBRARY_VIEW_MODE_KEY, viewMode).catch(() => {
      // Ignore persistence errors and keep UI responsive.
    })
  }, [viewMode])

  const loadMovies = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force === true
    const now = Date.now()

    if (syncInFlightRef.current && !force) {
      return
    }

    if (!force && now - lastSyncAtRef.current < 3000) {
      return
    }

    syncInFlightRef.current = true
    lastSyncAtRef.current = now

    try {
      const cachedMovies = (await getCachedMovies()).map(normalizeMovieForUi)
      setMovies(cachedMovies)
      setFiltered(cachedMovies)
      setLoading(false)
      setRefreshing(false)
      setError(null)

      void (async () => {
        try {
          const hydratedMovies = await normalizeMovieCoverUrls(
            cachedMovies,
            resolvedCoverUrlCacheRef.current,
            localCoverFileCacheRef.current
          )

          const completedMovies = await fillCoverCacheUntilComplete(
            hydratedMovies,
            resolvedCoverUrlCacheRef.current,
            localCoverFileCacheRef.current,
            (progressMovies) => {
              setMovies(progressMovies)
              setFiltered(progressMovies)
            }
          )

          setMovies(completedMovies)
          setFiltered(completedMovies)
          setError(null)
        } catch (coverError) {
          console.warn('Library cover hydration failed, keeping raw cached movies:', coverError)
        }
      })()

      if (!force) {
        return
      }

      setSyncing(true)
      // Run sync in background and then reload cache to keep UI resilient.
      syncStoredMoviesNow()
        .then(async () => {
          const updatedMovies = (await getCachedMovies()).map(normalizeMovieForUi)
          setMovies(updatedMovies)
          setFiltered(updatedMovies)

          void (async () => {
            try {
              const hydratedMovies = await normalizeMovieCoverUrls(
                updatedMovies,
                resolvedCoverUrlCacheRef.current,
                localCoverFileCacheRef.current
              )

              const completedMovies = await fillCoverCacheUntilComplete(
                hydratedMovies,
                resolvedCoverUrlCacheRef.current,
                localCoverFileCacheRef.current,
                (progressMovies) => {
                  setMovies(progressMovies)
                  setFiltered(progressMovies)
                }
              )

              setMovies(completedMovies)
              setFiltered(completedMovies)
              setError(null)
            } catch (coverError) {
              console.warn('Library refresh cover hydration failed:', coverError)
            }
          })()
        })
        .catch((error) => {
          console.warn('Library refresh sync failed:', error)
        })
        .finally(() => {
          setSyncing(false)
          setRefreshing(false)
        })
      return
    } catch (e) {
      setError((e as Error).message)
    } finally {
      syncInFlightRef.current = false
      if (!force) {
        setSyncing(false)
      }
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (didInitialLoadRef.current) return
    didInitialLoadRef.current = true
    // Keep startup as light as possible on low-memory devices/emulators.
    loadMovies()
  }, [loadMovies])

  useEffect(() => {
    const unsubscribe = subscribeStoredMoviesChanged(() => {
      loadMovies()
    })

    return unsubscribe
  }, [loadMovies])

  useEffect(() => {
    const unsubscribe = subscribeSyncStatus((isSyncing) => {
      setSyncing(isSyncing)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!refreshKey) return
    loadMovies()
  }, [refreshKey, loadMovies])

  useEffect(() => {
    let result = movies

    if (genreFilter !== '__all__') {
      result = result.filter((m) => Array.isArray(m.genres) && m.genres.includes(genreFilter))
    }

    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter((m) => {
        const title = typeof m.title === 'string' ? m.title.toLowerCase() : ''
        const cast = Array.isArray(m.cast_members)
          ? m.cast_members.filter((a): a is string => typeof a === 'string').map((a) => a.toLowerCase())
          : []
        const director = typeof m.director === 'string' ? m.director.toLowerCase() : ''

        return title.includes(q) || cast.some((a) => a.includes(q)) || director.includes(q)
      })
    }

    setFiltered(result)
  }, [query, movies, genreFilter])

  useEffect(() => {
    const type = typeof filterType === 'string' ? filterType : ''
    const value = typeof filterValue === 'string' ? filterValue : ''
    if (!type || !value) return

    const key = `${type}:${value}`
    if (lastAppliedFilterRef.current === key) return
    lastAppliedFilterRef.current = key

    if (type === 'genre') {
      setGenreFilter(value)
      setQuery('')
    }

    if (type === 'actor') {
      setGenreFilter('__all__')
      setQuery(value)
    }

    setViewMode('gallery')
    setGenreMenuOpen(false)
  }, [filterType, filterValue])

  const renderItem = ({ item }: { item: Movie }) => {
    if (viewMode === 'list') {
      return (
        <TouchableOpacity
          style={styles.listRow}
          onPress={() => router.push(`/movie/${item.id}`)}
          activeOpacity={0.8}
        >
          {ENABLE_LIBRARY_COVERS && typeof item.cover_url === 'string' && item.cover_url.length > 0 && !item.cover_url.startsWith('data:') ? (
            <CoverImage uri={item.cover_url} title={item.title} style={styles.listCover} />
          ) : (
            <View style={[styles.listCover, styles.coverPlaceholder]}>
              <Text style={styles.coverPlaceholderText}>[]</Text>
            </View>
          )}
          <View style={styles.listInfo}>
            <Text style={styles.listTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.listMeta} numberOfLines={1}>
              {[item.year ? String(item.year) : undefined, item.director, item.genres?.[0]]
                .filter(Boolean)
                .join(' | ') || '-'}
            </Text>
          </View>
        </TouchableOpacity>
      )
    }

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/movie/${item.id}`)}
        activeOpacity={0.8}
      >
        {ENABLE_LIBRARY_COVERS && typeof item.cover_url === 'string' && item.cover_url.length > 0 && !item.cover_url.startsWith('data:') ? (
          <CoverImage uri={item.cover_url} title={item.title} style={styles.cover} />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={styles.coverPlaceholderText}>[]</Text>
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
  }

  return (
    <View style={styles.container}>
      {/* Suchleiste */}
      <View style={styles.searchBar}>
        <View style={styles.searchInputWrap}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('library.searchPlaceholder')}
            placeholderTextColor="#64748b"
            value={query}
            onChangeText={setQuery}
            clearButtonMode="while-editing"
          />
          {query.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => setQuery('')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('library.clearSearch')}
            >
              <Text style={styles.clearBtnText}>X</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.viewBtn, viewMode === 'gallery' && styles.viewBtnActive]}
            onPress={() => setViewMode('gallery')}
          >
            <Text style={[styles.viewBtnText, viewMode === 'gallery' && styles.viewBtnTextActive]}>
              {t('library.viewGallery')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewBtn, viewMode === 'list' && styles.viewBtnActive]}
            onPress={() => setViewMode('list')}
          >
            <Text style={[styles.viewBtnText, viewMode === 'list' && styles.viewBtnTextActive]}>
              {t('library.viewList')}
            </Text>
          </TouchableOpacity>
        </View>

        {syncing && (
          <View style={styles.syncBanner}>
            <ActivityIndicator size="small" color="#60a5fa" />
            <Text style={styles.syncBannerText}>{t('library.syncing')}</Text>
          </View>
        )}

        <View style={[styles.genreFilterWrap, genreMenuOpen && styles.genreFilterWrapOpen]}>
          <Text style={styles.genreLabel}>{t('library.genreLabel')}</Text>
          <TouchableOpacity
            style={styles.genreDropdownTrigger}
            onPress={() => setGenreMenuOpen((prev) => !prev)}
            activeOpacity={0.85}
          >
            <Text style={styles.genreDropdownText} numberOfLines={1}>
              {allGenres.find((entry) => entry.value === genreFilter)?.label ?? t('library.genreAll')}
            </Text>
            <Text style={styles.genreDropdownChevron}>{genreMenuOpen ? '^' : 'v'}</Text>
          </TouchableOpacity>
          {genreMenuOpen && (
            <View style={styles.genreDropdownMenu}>
              {allGenres.map((entry) => (
                <TouchableOpacity
                  key={entry.value}
                  style={[
                    styles.genreDropdownOption,
                    genreFilter === entry.value && styles.genreDropdownOptionActive,
                  ]}
                  onPress={() => {
                    setGenreFilter(entry.value)
                    setGenreMenuOpen(false)
                  }}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.genreDropdownOptionText,
                      genreFilter === entry.value && styles.genreDropdownOptionTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {entry.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
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
            <Text style={styles.settingsBtnText}>{t('library.openSettings')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key={viewMode}
          data={filtered}
          keyExtractor={(item) => item.id || item.title}
          renderItem={renderItem}
          numColumns={viewMode === 'gallery' ? 2 : 1}
          initialNumToRender={viewMode === 'gallery' ? 12 : 20}
          maxToRenderPerBatch={viewMode === 'gallery' ? 8 : 12}
          updateCellsBatchingPeriod={50}
          windowSize={viewMode === 'gallery' ? 7 : 9}
          removeClippedSubviews={false}
          contentContainerStyle={viewMode === 'gallery' ? styles.grid : styles.listGrid}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadMovies({ force: true }) }}
              tintColor="#6366f1"
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {movies.length === 0
                  ? t('library.noMovies')
                  : t('library.noResults')}
              </Text>
            </View>
          }
          ListHeaderComponent={
            <Text style={styles.count}>{t('library.count', { count: filtered.length })}</Text>
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  searchBar: {
    padding: 12,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    gap: 10,
    zIndex: 30,
    elevation: 12,
  },
  searchInputWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: '#334155',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingRight: 40,
    paddingVertical: 8,
    fontSize: 15,
  },
  clearBtn: {
    position: 'absolute',
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#475569',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 12,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  grid: { padding: 8 },
  listGrid: { paddingHorizontal: 10, paddingBottom: 10 },
  count: { color: '#64748b', fontSize: 12, paddingHorizontal: 8, paddingBottom: 8 },
  viewToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 3,
    gap: 4,
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    backgroundColor: '#0b253a',
    borderColor: '#1d4f70',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncBannerText: {
    color: '#bae6fd',
    fontSize: 12,
    fontWeight: '600',
  },
  viewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  viewBtnActive: {
    backgroundColor: '#6366f1',
  },
  viewBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  viewBtnTextActive: {
    color: '#fff',
  },
  genreFilterWrap: {
    position: 'relative',
  },
  genreFilterWrapOpen: {
    zIndex: 40,
    elevation: 16,
  },
  genreLabel: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 6,
  },
  genreDropdownTrigger: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  genreDropdownText: {
    color: '#e2e8f0',
    fontSize: 13,
    flexShrink: 1,
  },
  genreDropdownChevron: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  genreDropdownMenu: {
    position: 'absolute',
    top: 62,
    left: 0,
    right: 0,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    overflow: 'hidden',
    zIndex: 50,
    elevation: 20,
  },
  genreDropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  genreDropdownOptionActive: {
    backgroundColor: '#4338ca',
  },
  genreDropdownOptionText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  genreDropdownOptionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
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
  cardInfo: { padding: 8 },
  cardTitle: { color: '#fff', fontSize: 12, fontWeight: '600', lineHeight: 16 },
  cardYear: { color: '#6366f1', fontSize: 11, marginTop: 2 },
  cardGenre: { color: '#64748b', fontSize: 11, marginTop: 1 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  listCover: {
    width: 42,
    height: 60,
    borderRadius: 6,
    overflow: 'hidden',
  },
  listInfo: {
    flex: 1,
    minWidth: 0,
  },
  listTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  listMeta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
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
