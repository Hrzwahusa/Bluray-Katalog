export interface Movie {
  id?: string
  title: string
  original_title?: string
  year?: number
  genres?: string[]
  cast_members?: string[]
  director?: string
  description?: string
  cover_url?: string
  bluray_photo_url?: string
  wikidata_id?: string
  imdb_id?: string
  runtime?: number
  rating?: number
  language?: string
  created_at?: string
  updated_at?: string
}

export interface WikidataMovie {
  wikidataId: string
  title: string
  originalTitle?: string
  year?: number
  genres: string[]
  cast: string[]
  director?: string
  description?: string
  coverUrl?: string
  imdbId?: string
  runtime?: number
}

export interface OcrResult {
  text: string
  confidence: number
}

export interface SearchResult {
  query: string
  results: WikidataMovie[]
}
