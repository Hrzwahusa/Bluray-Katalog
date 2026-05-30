import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Einstellungen (Supabase-Zugangsdaten)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: { supabaseUrl: string; supabaseKey: string; geminiKey: string; language: 'de' | 'en' }) =>
    ipcRenderer.invoke('settings:set', settings),
  getLocalMovies: () => ipcRenderer.invoke('movies:get-local'),
  setLocalMovies: (movies: import('@shared/types').Movie[]) => ipcRenderer.invoke('movies:set-local', movies),

  // OCR: Bild → Text
  recognizeText: (imageBase64: string) => ipcRenderer.invoke('ocr:recognize', imageBase64),

  // TMDB-Suche (läuft im Main-Prozess, kein CORS-Problem)
  searchMovies: (query: string, language?: string) => ipcRenderer.invoke('tmdb:search', query, language),
  getWikipediaDetails: (title: string, language: string) =>
    ipcRenderer.invoke('tmdb:details', title, language),
  searchMoviePoster: (title: string, year?: number, originalTitle?: string) =>
    ipcRenderer.invoke('tmdb:poster', title, year, originalTitle),
})

// TypeScript-Typen für window.api
export type ElectronAPI = typeof import('./index')['contextBridge']
