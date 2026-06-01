import * as FileSystem from 'expo-file-system/legacy'

const COVER_CACHE_DIR = `${FileSystem.cacheDirectory}cover-cache/`

type CacheCoverOptions = {
  verifyAgainstRemote?: boolean
  maxRetries?: number
}

function simpleHash(input: string): string {
  let hash = 5381
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function toSafeTitleSlug(title: string): string {
  const normalized = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const fallback = normalized || 'cover'
  return fallback.slice(0, 48)
}

function getFileExtension(url: string): string {
  const lower = url.toLowerCase()
  if (lower.includes('.png')) return 'png'
  if (lower.includes('.webp')) return 'webp'
  if (lower.includes('.jpeg')) return 'jpg'
  if (lower.includes('.jpg')) return 'jpg'
  return 'jpg'
}

function buildCachedCoverPath(coverUrl: string, title: string): string {
  const slug = toSafeTitleSlug(title)
  const ext = getFileExtension(coverUrl)
  const hash = simpleHash(coverUrl)
  return `${COVER_CACHE_DIR}${slug}-${hash}.${ext}`
}

function toFileUri(pathOrUri: string): string {
  if (!pathOrUri) return pathOrUri
  if (pathOrUri.startsWith('file://')) return pathOrUri
  if (pathOrUri.startsWith('/')) return `file://${pathOrUri}`
  return pathOrUri
}

export function isLocalCachedCoverUri(uri: string): boolean {
  if (!uri) return false
  return uri.startsWith('file://') || uri.startsWith(COVER_CACHE_DIR) || uri.startsWith('/data/') || uri.startsWith('/storage/')
}

async function getRemoteContentLength(coverUrl: string): Promise<number | undefined> {
  try {
    const response = await fetch(coverUrl, { method: 'HEAD' })
    if (!response.ok) return undefined
    const header = response.headers.get('content-length')
    if (!header) return undefined
    const parsed = Number(header)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

async function shouldRefreshCachedFile(localPath: string, coverUrl: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(localPath)
  if (!info.exists) return true

  const localSize = (info as { size?: number }).size
  const remoteSize = await getRemoteContentLength(coverUrl)
  if (!remoteSize || !localSize) {
    return false
  }

  return remoteSize !== localSize
}

async function downloadCoverWithRetries(coverUrl: string, localPath: string, maxRetries: number): Promise<string | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      console.log('[cover-cache] download:start', { coverUrl, localPath, attempt: attempt + 1, maxRetries: maxRetries + 1 })
      const downloaded = await FileSystem.downloadAsync(coverUrl, localPath)
      if (downloaded.status >= 200 && downloaded.status < 300) {
        console.log('[cover-cache] download:success', { coverUrl, localPath: downloaded.uri, status: downloaded.status })
        return downloaded.uri
      }
      console.warn('[cover-cache] download:bad-status', { coverUrl, localPath, status: downloaded.status, attempt: attempt + 1 })
    } catch {
      console.warn('[cover-cache] download:error', { coverUrl, localPath, attempt: attempt + 1 })
    }
  }
  return null
}

export async function getCachedCoverUri(coverUrl: string, title: string, options: CacheCoverOptions = {}): Promise<string> {
  if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
    return coverUrl
  }

  const targetPath = buildCachedCoverPath(coverUrl, title)
  const verifyAgainstRemote = options.verifyAgainstRemote === true
  const maxRetries = Number.isFinite(options.maxRetries) ? Math.max(0, options.maxRetries ?? 0) : 0

  try {
    await FileSystem.makeDirectoryAsync(COVER_CACHE_DIR, { intermediates: true })

    const existing = await FileSystem.getInfoAsync(targetPath)
    if (existing.exists) {
      if (!verifyAgainstRemote) {
        console.log('[cover-cache] hit', { coverUrl, targetPath: existing.uri ?? targetPath })
        return toFileUri(existing.uri ?? targetPath)
      }

      const refreshNeeded = await shouldRefreshCachedFile(targetPath, coverUrl)
      if (!refreshNeeded) {
        console.log('[cover-cache] hit-verified', { coverUrl, targetPath: existing.uri ?? targetPath })
        return toFileUri(existing.uri ?? targetPath)
      }

      console.log('[cover-cache] refresh-needed', { coverUrl, targetPath })
    }

    const downloadedUri = await downloadCoverWithRetries(coverUrl, targetPath, maxRetries)
    if (downloadedUri) {
      return downloadedUri
    }

    console.warn('[cover-cache] fallback-remote', { coverUrl, targetPath, hadExisting: existing.exists })
    return existing.exists ? toFileUri(existing.uri ?? targetPath) : coverUrl
  } catch {
    console.warn('[cover-cache] get:error', { coverUrl, targetPath })
    return coverUrl
  }
}
