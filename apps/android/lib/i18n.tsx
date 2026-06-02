import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as SecureStore from 'expo-secure-store'

export type AppLanguage = 'de' | 'en'

type TranslateParams = Record<string, string | number>

type Dictionary = Record<string, string>

const dictionaries: Record<AppLanguage, Dictionary> = {
  de: {
    'tab.library': 'Bibliothek',
    'tab.scan': 'Scannen',
    'header.settings': 'Einstellungen',
    'header.movieDetails': 'Filmdetails',

    'library.searchPlaceholder': 'Suche...',
    'library.missingSupabase': 'Bitte Supabase-Zugangsdaten in den Einstellungen hinterlegen.',
    'library.openSettings': 'Einstellungen öffnen',
    'library.noMovies': 'Noch keine Filme. Scanne ein Cover!',
    'library.noResults': 'Keine Treffer',
    'library.count': '{count} Filme',
    'library.viewGallery': 'Galerie',
    'library.viewList': 'Liste',
    'library.clearSearch': 'Suche leeren',
    'library.genreLabel': 'Genre',
    'library.genreAll': 'Alle Genres',
    'library.syncing': 'Synchronisiere mit Supabase...',

    'scan.cameraError': 'Kamerafehler: {message}',
    'scan.ocrRunning': 'Titelerkennung läuft...',
    'scan.ocrError': 'Erkennungsfehler: {message}',
    'scan.searchRunning': 'Suche in TMDB...',
    'scan.searchError': 'Suchfehler: {message}',
    'scan.searchNoneFound': 'Keine Filme gefunden.',
    'scan.missingSupabase': 'Bitte Supabase-Zugangsdaten in den Einstellungen hinterlegen.',
    'scan.fetchWiki': 'Hole TMDB-Details...',
    'scan.searchPoster': 'Suche Film-Poster...',
    'scan.saving': 'Speichere...',
    'scan.saveError': 'Fehler: {message}',
    'scan.permissionRequired': 'Kamera-Berechtigung erforderlich',
    'scan.grantPermission': 'Berechtigung erteilen',
    'scan.pickGallery': 'Aus Galerie wählen',
    'scan.enterTitleManually': 'Titel manuell eingeben',
    'scan.frameHint': 'Blu-ray Cover im Rahmen positionieren',
    'scan.galleryShort': 'Galerie',
    'scan.titleShort': 'Titel',
    'scan.movieTitlePlaceholder': 'Filmtitel...',
    'scan.searchButton': 'Suchen',
    'scan.manualCardTitle': 'Film manuell eingeben',
    'scan.manualCardSubtitle': 'Kein Treffer? Film und Metadaten selbst erfassen.',
    'scan.manualFormTitle': 'Manuelle Eingabe',
    'scan.manualFieldTitle': 'Titel *',
    'scan.manualFieldOriginalTitle': 'Originaltitel',
    'scan.manualFieldYear': 'Jahr',
    'scan.manualFieldDirector': 'Regie',
    'scan.manualFieldGenres': 'Genres (kommagetrennt)',
    'scan.manualFieldCast': 'Darsteller (kommagetrennt)',
    'scan.manualFieldRuntime': 'Laufzeit (Min.)',
    'scan.manualFieldImdb': 'IMDb-ID',
    'scan.manualFieldDescription': 'Beschreibung',
    'scan.manualCreateCandidate': 'Zur Bestätigung',
    'scan.manualTitleRequired': 'Bitte einen Titel eingeben.',
    'scan.confirmYear': 'Jahr: {value}',
    'scan.confirmDirector': 'Regie: {value}',
    'scan.confirmCast': 'Darsteller: {value}',
    'scan.saveSelected': 'Speichern',
    'scan.back': 'Zurück',
    'scan.backToCamera': 'Zur Kamera',
    'scan.saved': 'Film gespeichert!',
    'scan.scanNext': 'Weiteres Cover scannen',
    'scan.toLibrary': 'Zur Bibliothek',

    'settings.language': 'Sprache',
    'settings.languageHelp': 'Wähle die App-Sprache.',
    'settings.languageGerman': 'Deutsch',
    'settings.languageEnglish': 'English',
    'settings.supabaseTitle': 'Supabase Sync',
    'settings.supabaseDescription': 'Die App speichert Filme immer lokal auf dem Geraet. Wenn du hier Supabase-Zugangsdaten eintraegst, wird der lokale Katalog zusaetzlich mit Supabase synchronisiert.',
    'settings.openSupabase': 'Supabase im Browser öffnen',
    'settings.openSupabaseError': 'Supabase-Link konnte nicht geöffnet werden.',
    'settings.copySchema': 'schema.sql in Zwischenablage kopieren',
    'settings.copySchemaDone': 'schema.sql wurde in die Zwischenablage kopiert.',
    'settings.copySchemaError': 'Konnte schema.sql nicht kopieren.',
    'settings.supabaseUrl': 'Supabase URL',
    'settings.anonKey': 'Anon (Public) Key',
    'settings.anonHint': 'Zu finden unter: Dashboard -> Project Settings -> API -> anon (public)',
    'settings.supabaseOptionalHint': 'Leer lassen fuer rein lokale Nutzung. Sobald URL und Key gesetzt sind, werden lokale Filme nach Supabase gespiegelt und Remote-Filme lokal uebernommen.',
    'settings.urlRequiredWhenKey': 'Bitte auch die Supabase-URL eintragen.',
    'settings.keyRequiredWhenUrl': 'Bitte auch den Supabase-Key eintragen.',
    'settings.geminiTitle': 'KI-Titelerkennung (Gemini)',
    'settings.geminiDescription': 'Kostenlosen API-Schlüssel auf aistudio.google.com erstellen (15 Anfragen/Minute gratis). Ohne Key nutzt die App auf Android ML Kit als lokalen OCR-Fallback.',
    'settings.geminiKey': 'Gemini API Key',
    'settings.geminiHint': 'Zu finden unter: aistudio.google.com -> API Keys',
    'settings.save': 'Einstellungen speichern',
    'settings.saved': 'Gespeichert!',
    'settings.cardMovies': 'Filmdaten',
    'settings.cardCover': 'Cover',
    'settings.cardDb': 'Datenbank',
    'settings.cardDbValue': 'Lokal + Supabase Sync',

    'alert.error': 'Fehler',
    'alert.fillBothFields': 'Bitte beide Felder ausfüllen.',
    'alert.urlMustHttps': 'URL muss mit https:// beginnen.',

    'movie.notFound': 'Film nicht gefunden.',
    'movie.deleteTitle': 'Film löschen',
    'movie.deleteConfirm': '"{title}" wirklich löschen?',
    'movie.cancel': 'Abbrechen',
    'movie.delete': 'Löschen',
    'movie.titleEmpty': 'Der Titel darf nicht leer sein.',
    'movie.saving': 'Speichere...',
    'movie.save': 'Speichern',
    'movie.edit': 'Bearbeiten',
    'movie.deleteMovie': 'Film löschen',
    'movie.titleField': 'Titel',
    'movie.year': 'Jahr',
    'movie.director': 'Regie',
    'movie.runtime': 'Laufzeit',
    'movie.runtimeMinutesLabel': 'Laufzeit (Min.)',
    'movie.runtimeMinutes': '{value} Min.',
    'movie.rating': 'Bewertung',
    'movie.ratingValue': '{value}/10',
    'movie.genres': 'Genres',
    'movie.cast': 'Hauptdarsteller',
    'movie.description': 'Beschreibung',
    'movie.originalTitle': 'Originaltitel',
    'movie.language': 'Sprache',
    'movie.imdbId': 'IMDb-ID',
    'movie.openTmdb': 'Auf TMDB öffnen',
    'movie.tmdbOpenError': 'TMDB-Link konnte nicht geöffnet werden.',
    'movie.wikidataId': 'TMDB-ID',
    'movie.coverUrl': 'Cover-URL',
    'movie.refreshCover': 'Cover aktualisieren',
    'movie.refreshingCover': 'Aktualisiere Cover...',
    'movie.searchingCoverCandidates': 'Suche Cover-Kandidaten...',
    'movie.coverCandidatesTitle': 'Passendes Cover auswählen',
    'movie.refreshCoverUnavailable': 'Für dieses Cover ist keine ursprüngliche URL zum Neuladen verfügbar.',
    'movie.refreshCoverSearchError': 'Kein neues Cover bei TMDB gefunden.',
    'movie.photoUrl': 'Foto-URL (lokal)',
    'movie.genresCsv': 'Genres (kommagetrennt)',
    'movie.castCsv': 'Darsteller (kommagetrennt)',
  },
  en: {
    'tab.library': 'Library',
    'tab.scan': 'Scan',
    'header.settings': 'Settings',
    'header.movieDetails': 'Movie details',

    'library.searchPlaceholder': 'Search...',
    'library.missingSupabase': 'Please add your Supabase credentials in Settings.',
    'library.openSettings': 'Open settings',
    'library.noMovies': 'No movies yet. Scan a cover!',
    'library.noResults': 'No results',
    'library.count': '{count} movies',
    'library.viewGallery': 'Gallery',
    'library.viewList': 'List',
    'library.clearSearch': 'Clear search',
    'library.genreLabel': 'Genre',
    'library.genreAll': 'All genres',
    'library.syncing': 'Syncing with Supabase...',

    'scan.cameraError': 'Camera error: {message}',
    'scan.ocrRunning': 'Recognizing title...',
    'scan.ocrError': 'Recognition error: {message}',
    'scan.searchRunning': 'Searching TMDB...',
    'scan.searchError': 'Search error: {message}',
    'scan.searchNoneFound': 'No movies found.',
    'scan.missingSupabase': 'Please add your Supabase credentials in Settings.',
    'scan.fetchWiki': 'Loading TMDB details...',
    'scan.searchPoster': 'Searching movie poster...',
    'scan.saving': 'Saving...',
    'scan.saveError': 'Error: {message}',
    'scan.permissionRequired': 'Camera permission required',
    'scan.grantPermission': 'Grant permission',
    'scan.pickGallery': 'Pick from gallery',
    'scan.enterTitleManually': 'Enter title manually',
    'scan.frameHint': 'Place the Blu-ray cover inside the frame',
    'scan.galleryShort': 'Gallery',
    'scan.titleShort': 'Title',
    'scan.movieTitlePlaceholder': 'Movie title...',
    'scan.searchButton': 'Search',
    'scan.manualCardTitle': 'Enter movie manually',
    'scan.manualCardSubtitle': 'No match? Enter movie and metadata yourself.',
    'scan.manualFormTitle': 'Manual entry',
    'scan.manualFieldTitle': 'Title *',
    'scan.manualFieldOriginalTitle': 'Original title',
    'scan.manualFieldYear': 'Year',
    'scan.manualFieldDirector': 'Director',
    'scan.manualFieldGenres': 'Genres (comma-separated)',
    'scan.manualFieldCast': 'Cast (comma-separated)',
    'scan.manualFieldRuntime': 'Runtime (min)',
    'scan.manualFieldImdb': 'IMDb ID',
    'scan.manualFieldDescription': 'Description',
    'scan.manualCreateCandidate': 'Continue to confirmation',
    'scan.manualTitleRequired': 'Please enter a title.',
    'scan.confirmYear': 'Year: {value}',
    'scan.confirmDirector': 'Director: {value}',
    'scan.confirmCast': 'Cast: {value}',
    'scan.saveSelected': 'Save',
    'scan.back': 'Back',
    'scan.backToCamera': 'Back to camera',
    'scan.saved': 'Movie saved!',
    'scan.scanNext': 'Scan another cover',
    'scan.toLibrary': 'Back to library',

    'settings.language': 'Language',
    'settings.languageHelp': 'Choose the app language.',
    'settings.languageGerman': 'Deutsch',
    'settings.languageEnglish': 'English',
    'settings.supabaseTitle': 'Supabase sync',
    'settings.supabaseDescription': 'The app always stores movies locally on the device. If you add Supabase credentials here, the local catalog will also sync with Supabase.',
    'settings.openSupabase': 'Open Supabase in browser',
    'settings.openSupabaseError': 'Could not open the Supabase link.',
    'settings.copySchema': 'Copy schema.sql to clipboard',
    'settings.copySchemaDone': 'schema.sql copied to clipboard.',
    'settings.copySchemaError': 'Could not copy schema.sql.',
    'settings.supabaseUrl': 'Supabase URL',
    'settings.anonKey': 'Anon (Public) Key',
    'settings.anonHint': 'Find it at: Dashboard -> Project Settings -> API -> anon (public)',
    'settings.supabaseOptionalHint': 'Leave both fields empty for local-only usage. As soon as URL and key are set, local movies are mirrored to Supabase and remote movies are pulled back locally.',
    'settings.urlRequiredWhenKey': 'Please enter the Supabase URL as well.',
    'settings.keyRequiredWhenUrl': 'Please enter the Supabase key as well.',
    'settings.geminiTitle': 'AI title recognition (Gemini)',
    'settings.geminiDescription': 'Create a free API key on aistudio.google.com (15 req/min free). Without a key, the Android app uses ML Kit as a local OCR fallback.',
    'settings.geminiKey': 'Gemini API Key',
    'settings.geminiHint': 'Find it at: aistudio.google.com -> API Keys',
    'settings.save': 'Save settings',
    'settings.saved': 'Saved!',
    'settings.cardMovies': 'Movie data',
    'settings.cardCover': 'Cover',
    'settings.cardDb': 'Database',
    'settings.cardDbValue': 'Local + Supabase sync',

    'alert.error': 'Error',
    'alert.fillBothFields': 'Please fill in both fields.',
    'alert.urlMustHttps': 'URL must start with https://.',

    'movie.notFound': 'Movie not found.',
    'movie.deleteTitle': 'Delete movie',
    'movie.deleteConfirm': 'Delete "{title}"?',
    'movie.cancel': 'Cancel',
    'movie.delete': 'Delete',
    'movie.titleEmpty': 'Title must not be empty.',
    'movie.saving': 'Saving...',
    'movie.save': 'Save',
    'movie.edit': 'Edit',
    'movie.deleteMovie': 'Delete movie',
    'movie.titleField': 'Title',
    'movie.year': 'Year',
    'movie.director': 'Director',
    'movie.runtime': 'Runtime',
    'movie.runtimeMinutesLabel': 'Runtime (min)',
    'movie.runtimeMinutes': '{value} min',
    'movie.rating': 'Rating',
    'movie.ratingValue': '{value}/10',
    'movie.genres': 'Genres',
    'movie.cast': 'Cast',
    'movie.description': 'Description',
    'movie.originalTitle': 'Original title',
    'movie.language': 'Language',
    'movie.imdbId': 'IMDb ID',
    'movie.openTmdb': 'Open on TMDB',
    'movie.tmdbOpenError': 'Could not open TMDB link.',
    'movie.wikidataId': 'TMDB ID',
    'movie.coverUrl': 'Cover URL',
    'movie.refreshCover': 'Refresh cover',
    'movie.refreshingCover': 'Refreshing cover...',
    'movie.searchingCoverCandidates': 'Searching cover candidates...',
    'movie.coverCandidatesTitle': 'Choose the matching cover',
    'movie.refreshCoverUnavailable': 'No original URL is available for reloading this cover.',
    'movie.refreshCoverSearchError': 'No new cover found on TMDB.',
    'movie.photoUrl': 'Photo URL (local)',
    'movie.genresCsv': 'Genres (comma-separated)',
    'movie.castCsv': 'Cast (comma-separated)',
  },
}

const STORAGE_KEY = 'appLanguage'

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return Object.entries(params).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value))
  }, template)
}

function translate(language: AppLanguage, key: string, params?: TranslateParams): string {
  const value = dictionaries[language][key] ?? dictionaries.de[key] ?? key
  return interpolate(value, params)
}

type LanguageContextValue = {
  language: AppLanguage
  setLanguage: (language: AppLanguage) => Promise<void>
  t: (key: string, params?: TranslateParams) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en')

  useEffect(() => {
    let mounted = true
    const loadLanguage = async () => {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY)
      if (!mounted) return
      if (stored === 'de' || stored === 'en') {
        setLanguageState(stored)
      }
    }
    loadLanguage()
    return () => {
      mounted = false
    }
  }, [])

  const setLanguage = async (nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage)
    await SecureStore.setItemAsync(STORAGE_KEY, nextLanguage)
  }

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key: string, params?: TranslateParams) => translate(language, key, params),
  }), [language])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useI18n() {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error('useI18n must be used inside LanguageProvider')
  }
  return ctx
}
