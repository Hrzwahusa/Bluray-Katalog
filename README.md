# BluRay Katalog

Desktop- und Android-App zur Verwaltung einer privaten Blu-ray-Sammlung mit Scan-Workflow, automatischer Titelerkennung und TMDB-Metadaten.

Die App arbeitet lokal-first: Filme werden immer lokal gespeichert. Supabase ist optional und wird nur genutzt, wenn URL + Key in den Einstellungen hinterlegt sind.

## Features

- Cover per Kamera oder Galerie erfassen
- Automatische Titelerkennung mit Gemini auf Android (Google ML Kit als Fallback) 
- Desktop-OCR mit Gemini als Primärweg und Tesseract.js als Fallback
- Filmdaten und Coverbilder über TMDB ohne eigenen Backend-Server
- Lokal-first Speicherung auf dem Gerät
- Optionaler Supabase-Sync (bei konfigurierter URL + Key)
- Electron-Desktop-App für Windows und Linux
- Expo-basierte Android-App mit Expo Router

## Monorepo-Struktur

```text
.
├── apps/
│   ├── android/      Expo / React Native App
│   └── desktop/      Electron / React / Vite App
├── packages/
│   └── shared/       Gemeinsame Typen und API-Logik
├── supabase/
│   └── schema.sql    Datenbankschema
├── package.json
└── README.md
```

## Voraussetzungen

- Node.js 20+
- npm
- Für Android: Android Studio bzw. Android SDK und ein verbundenes Gerät oder Emulator
- Optional: Gemini API-Key für die automatische Titelerkennung
- Optional: Supabase-Projekt für Geräte-übergreifende Synchronisierung

## Setup

### 1. Repository installieren

```bash
npm install --legacy-peer-deps
```

### 2. Optional: Supabase einrichten

1. Auf supabase.com ein neues Projekt anlegen.
2. Im SQL Editor den Inhalt aus [supabase/schema.sql](supabase/schema.sql) ausführen.
3. Unter Project Settings > API die Projekt-URL und den `anon`-Key kopieren.
4. Diese Werte später in der Desktop- bzw. Android-App unter Einstellungen eintragen.

Ohne eingetragene Supabase-Zugangsdaten bleibt die App vollständig lokal nutzbar.

### 3. Optional: Gemini konfigurieren

Für die Titelerkennung kann ein Gemini API-Key hinterlegt werden.

- Android: in der App unter Einstellungen
- Desktop: in der App unter Einstellungen

Ohne Gemini funktioniert die Desktop-App weiterhin mit Tesseract-Fallback. Auf Android funktioniert die Erkennung weiterhin über Google ML Kit und die manuelle Filmsuche bleibt nutzbar.

## Entwicklung

### Desktop

```bash
npm run desktop
```

Build:

```bash
npm run desktop:build
npm run desktop:package
```

### Android

Dev-Server starten:

```bash
npm run android --workspace=apps/android
```

Oder direkt im App-Ordner:

```bash
cd apps/android
npx expo start --dev-client --clear
```

Native Android-App auf ein Gerät installieren:

```bash
cd apps/android
npx expo run:android --device
```

EAS-Build:

```bash
cd apps/android
eas build --platform android
```

Lokaler Release-Build (AAB, ohne EAS Queue, Windows):

```bash
npm run android:build:production:local
```

Direkter lokaler Release-APK-Build:

```bash
cd apps/android/android
./gradlew.bat assembleRelease
```

## Releases

### Android Release-APK (für GitHub Release)

```bash
cd apps/android/android
./gradlew.bat assembleRelease
```

Output:

`apps/android/android/app/build/outputs/apk/release/app-release.apk`

### Android AAB (für Play Console)

```bash
cd apps/android/android
./gradlew.bat bundleRelease
```

Output:

`apps/android/android/app/build/outputs/bundle/release/app-release.aab`

### Desktop Windows Release

```bash
npm run desktop:package:portable
```

Output:

`apps/desktop/release/BluRay-Katalog-win-unpacked.zip`

Hinweise:

- Für GitHub Releases nur Desktop-Artefakt(e) und APK hochladen.
- Die AAB ist für die Play Console und sollte nicht im GitHub Release landen.
- Optional können Android-Releases weiterhin über EAS gebaut werden (`eas build --platform android`).

## Technologie-Stack

| Bereich | Technologie |
|---|---|
| Desktop | Electron, React, Vite |
| Android | Expo, React Native, Expo Router |
| OCR / Erkennung | Gemini, Tesseract.js |
| Filmdaten | TMDB |
| Datenbank | Supabase |
| Shared Code | TypeScript Workspace-Paket |

## Datenmodell

Die zentrale Tabelle `movies` wird über [supabase/schema.sql](supabase/schema.sql) angelegt. Relevante Felder sind unter anderem:

- `title`
- `original_title`
- `year`
- `genres`
- `cast_members`
- `director`
- `description`
- `cover_url`
- `bluray_photo_url`
- `wikidata_id` (TMDB-ID)
- `imdb_id`
- `runtime`

## Hinweise

- Zugangsdaten werden lokal in den jeweiligen Apps gespeichert und nicht im Repository verwaltet.
- Build-Artefakte, lokale SDK-Pfade und Abhängigkeiten sollten nicht versioniert werden.


## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Details siehe [LICENSE](LICENSE).

