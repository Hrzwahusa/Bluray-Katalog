import { File, Paths } from 'expo-file-system'

const COVER_CACHE_DIR = `${Paths.cache}cover-cache/`

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

export async function deleteCachedCover(coverUrl: string, title: string): Promise<void> {
  if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
    return
  }

  const targetPath = buildCachedCoverPath(coverUrl, title)
  try {
    const file = new File(targetPath)
    if (!file.exists) {
      return
    }

    file.delete()
  } catch {
    // If the cache entry cannot be removed, the next load will fall back to the existing file.
  }
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
  const file = new File(localPath)
  if (!file.exists) return true

  const localSize = file.size
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
      const file = new File(localPath)
      await File.downloadFileAsync(coverUrl, file, { idempotent: true })
      if (file.exists) {
        console.log('[cover-cache] download:success', { coverUrl, localPath: file.uri })
        return file.uri
      }
      console.warn('[cover-cache] download:bad-status', { coverUrl, localPath, attempt: attempt + 1 })
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
    const cacheDir = new File(COVER_CACHE_DIR)
    if (!cacheDir.exists) {
      cacheDir.create({ intermediates: true })
    }

    const existing = new File(targetPath)
    if (existing.exists) {
      if (!verifyAgainstRemote) {
        console.log('[cover-cache] hit', { coverUrl, targetPath: existing.uri })
        return toFileUri(existing.uri)
      }

      const refreshNeeded = await shouldRefreshCachedFile(targetPath, coverUrl)
      if (!refreshNeeded) {
        console.log('[cover-cache] hit-verified', { coverUrl, targetPath: existing.uri })
        return toFileUri(existing.uri)
      }

      console.log('[cover-cache] refresh-needed', { coverUrl, targetPath })
    }

    const downloadedUri = await downloadCoverWithRetries(coverUrl, targetPath, maxRetries)
    if (downloadedUri) {
      return downloadedUri
    }

    console.warn('[cover-cache] fallback-remote', { coverUrl, targetPath, hadExisting: existing.exists })
    return existing.exists ? toFileUri(existing.uri) : coverUrl
  } catch {
    console.warn('[cover-cache] get:error', { coverUrl, targetPath })
    return coverUrl
  }
}
