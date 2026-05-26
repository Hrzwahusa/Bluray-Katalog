import { app, BrowserWindow, ipcMain, shell, session } from 'electron'
import { join } from 'path'
import { createWorker } from 'tesseract.js'
import { GoogleGenAI } from '@google/genai'
import ElectronStore from 'electron-store'
import { searchMovieFuzzy, getWikipediaDetails, searchMoviePoster } from '@shared/wikidata'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Store = (ElectronStore as any).default || ElectronStore
const store = new Store<{ supabaseUrl: string; supabaseKey: string }>()

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
  coverImageUrl?: string
  posterHints?: string[]
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
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
      coverImageUrl: cleanString(parsed.coverImageUrl),
      posterHints: cleanStringArray(parsed.posterHints),
    }

    if (!guess.title) return null
    return guess
  } catch {
    const plainTitle = trimmed.replace(/^["']|["']$/g, '')
    return plainTitle ? { title: plainTitle } : null
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutId = setTimeout(() => resolve(fallback), timeoutMs)
    })
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e1b4b',
      symbolColor: '#ffffff',
    },
    icon: join(__dirname, '../../resources/icon.png'),
  })

  // Externe Links im Standard-Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.NODE_ENV === 'development' && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Kamera- und Mikrofon-Berechtigungen im Renderer automatisch gewähren
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'camera', 'microphone', 'display-capture']
    callback(allowed.includes(permission))
  })

  // Synchroner Berechtigungs-Check (wird vor dem Request-Handler aufgerufen)
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'camera', 'microphone', 'display-capture', 'mediaKeySystem']
    return allowed.includes(permission)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC Handler: Einstellungen ─────────────────────────────────────
ipcMain.handle('settings:get', () => {
  return {
    supabaseUrl: store.get('supabaseUrl', ''),
    supabaseKey: store.get('supabaseKey', ''),
    geminiKey: store.get('geminiKey', ''),
  }
})

ipcMain.handle('settings:set', (_, settings: { supabaseUrl: string; supabaseKey: string; geminiKey: string }) => {
  store.set('supabaseUrl', settings.supabaseUrl)
  store.set('supabaseKey', settings.supabaseKey)
  store.set('geminiKey', settings.geminiKey)
  return true
})

// ─── IPC Handler: OCR mit Gemini (primär) oder Tesseract (Fallback) ─
ipcMain.handle('ocr:recognize', async (_, imageBase64: string) => {
  if (!imageBase64 || imageBase64.length < 100) {
    return { text: '', confidence: 0, error: 'Kein gültiges Bild übergeben.' }
  }

  const geminiKey = store.get('geminiKey', '') as string
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')
  const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'

  console.log('[OCR] geminiKey vorhanden:', geminiKey ? `Ja (${geminiKey.length} Zeichen)` : 'Nein')

  // ── Gemini (wenn Key vorhanden) ──────────────────────────────────
  if (geminiKey) {
    try {
      console.log('[Gemini] Starte Anfrage...')
      const genAI = new GoogleGenAI({ apiKey: geminiKey })
      const result = await genAI.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { data: base64Data, mimeType } },
              {
                text:
                  'You are analyzing a Blu-ray or DVD movie cover photo. Return STRICT JSON only (no markdown, no commentary) with this shape: ' +
                  '{"title":"","originalTitle":"","year":null,"director":"","genres":[],"cast":[],"runtime":null,"imdbId":"","description":"","coverImageUrl":"","posterHints":[]}. ' +
                  'Rules: 1) title must be the main movie title from the cover. 2) Use null for unknown numbers and empty strings/arrays for unknown text fields. ' +
                  '3) Keep genres and cast short and relevant. 4) coverImageUrl may be empty and should only be set when a direct likely poster image URL is visible on the cover/source context. 5) posterHints should contain short alternate search titles (e.g., subtitle, translated title variant) when useful. 6) Do not invent highly specific facts; leave fields empty if uncertain.',
              },
            ],
          },
        ],
      })
      const rawText = (result.text ?? '').trim()
      const guess = parseGeminiMovieGuess(rawText)
      const text = guess?.title ?? ''
      console.log('[Gemini] Ergebnis:', text)
      console.log('[Gemini] Cover-Vorschlag:', guess?.coverImageUrl ?? 'keiner')
      console.log('[Gemini] Poster-Hints:', (guess?.posterHints ?? []).join(' | ') || 'keine')
      return { text, confidence: 95, movieGuess: guess }
    } catch (e) {
      const err = e as Error
      console.error('[Gemini] Fehler:', err.name, err.message)
      // Fallthrough zu Tesseract
    }
  }

  // ── Tesseract Fallback ───────────────────────────────────────────
  const worker = await createWorker(['deu', 'eng'], 1)
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' })
    const buffer = Buffer.from(base64Data, 'base64')
    const { data } = await worker.recognize(buffer)
    return {
      text: data.text.trim(),
      confidence: data.confidence,
    }
  } catch (e) {
    return { text: '', confidence: 0, error: (e as Error).message }
  } finally {
    await worker.terminate()
  }
})

// ─── IPC Handler: Wikidata-Suche ────────────────────────────────────
ipcMain.handle('wikidata:search', async (_, query: string, language?: string) => {
  return await searchMovieFuzzy(query, language ?? 'de')
})

ipcMain.handle('wikidata:details', async (_, title: string, language: string) => {
  return await getWikipediaDetails(title, language)
})

ipcMain.handle('wikidata:poster', async (_, title: string, year?: number, originalTitle?: string) => {
  const label = originalTitle && originalTitle !== title ? `${originalTitle} / ${title}` : title
  console.log('[Poster] Suche Poster für:', label, year)
  const url = await withTimeout(
    searchMoviePoster(title, year, originalTitle),
    30000,
    undefined
  )
  if (!url) {
    console.warn('[Poster] Timeout/kein Ergebnis innerhalb 30s')
  }
  console.log('[Poster] Ergebnis:', url ?? 'keines gefunden')
  return url
})
