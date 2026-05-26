// Typen für die Electron API (window.api)
interface ElectronAPI {
  getSettings: () => Promise<{ supabaseUrl: string; supabaseKey: string; geminiKey: string }>
  setSettings: (settings: { supabaseUrl: string; supabaseKey: string; geminiKey: string }) => Promise<boolean>
  recognizeText: (imageBase64: string) => Promise<{
    text: string
    confidence: number
    error?: string
    movieGuess?: {
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
    } | null
  }>
  searchMovies: (query: string, language?: string) => Promise<import('../../../../packages/shared/src/types').WikidataMovie[]>
  getWikipediaDetails: (title: string, language: string) => Promise<{ coverUrl?: string; description?: string }>
  searchMoviePoster: (title: string, year?: number, originalTitle?: string) => Promise<string | undefined>
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

export {}
