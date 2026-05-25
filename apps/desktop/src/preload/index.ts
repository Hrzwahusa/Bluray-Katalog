import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Einstellungen (Supabase-Zugangsdaten)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: { supabaseUrl: string; supabaseKey: string; geminiKey: string }) =>
    ipcRenderer.invoke('settings:set', settings),

  // OCR: Bild → Text
  recognizeText: (imageBase64: string) => ipcRenderer.invoke('ocr:recognize', imageBase64),

  // Wikidata-Suche (läuft im Main-Prozess, kein CORS-Problem)
  searchMovies: (query: string, language?: string) => ipcRenderer.invoke('wikidata:search', query, language),
  getWikipediaDetails: (title: string, language: string) =>
    ipcRenderer.invoke('wikidata:details', title, language),
  searchMoviePoster: (title: string, year?: number, originalTitle?: string) =>
    ipcRenderer.invoke('wikidata:poster', title, year, originalTitle),
})

// TypeScript-Typen für window.api
export type ElectronAPI = typeof import('./index')['contextBridge']
