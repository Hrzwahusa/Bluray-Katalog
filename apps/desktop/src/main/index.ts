import { app, BrowserWindow, ipcMain, shell, session } from 'electron'
import { join } from 'path'
import { createWorker } from 'tesseract.js'
import { GoogleGenAI } from '@google/genai'
import ElectronStore from 'electron-store'
import { searchMovieFuzzy, getWikipediaDetails, searchMoviePoster } from '@shared/wikidata'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Store = (ElectronStore as any).default || ElectronStore
const store = new Store<{ supabaseUrl: string; supabaseKey: string }>()

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
                  'This is a photo of a Blu-ray or DVD movie cover. What is the exact movie title shown on the cover? ' +
                  'Return ONLY the movie title, nothing else. No explanations, no quotes, no punctuation at the end. ' +
                  'If you cannot determine a title, return an empty string.',
              },
            ],
          },
        ],
      })
      const text = (result.text ?? '').trim().replace(/^["']|["']$/g, '')
      console.log('[Gemini] Ergebnis:', text)
      return { text, confidence: 95 }
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
  const url = await searchMoviePoster(title, year, originalTitle)
  console.log('[Poster] Ergebnis:', url ?? 'keines gefunden')
  return url
})
