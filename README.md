# BluRay Katalog

Desktop- und Android-App zur Verwaltung einer privaten Blu-ray-Sammlung mit Scan-Workflow, automatischer Titelerkennung, TMDB-Metadaten und gemeinsamer Supabase-Datenbank.

## Features

- Cover per Kamera oder Galerie erfassen
- Automatische Titelerkennung mit Gemini auf Android
- Desktop-OCR mit Gemini als Primärweg und Tesseract.js als Fallback
- Filmdaten und Coverbilder über TMDB ohne eigenen Backend-Server
- Gemeinsame Film-Datenbank über Supabase
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
- Supabase-Projekt
- Für Android: Android Studio bzw. Android SDK und ein verbundenes Gerät oder Emulator
- Optional: Gemini API-Key für die automatische Titelerkennung

## Setup

### 1. Repository installieren

```bash
npm install --legacy-peer-deps
```

### 2. Supabase einrichten

1. Auf supabase.com ein neues Projekt anlegen.
2. Im SQL Editor den Inhalt aus [supabase/schema.sql](supabase/schema.sql) ausführen.
3. Unter Project Settings > API die Projekt-URL und den `anon`-Key kopieren.
4. Diese Werte später in der Desktop- bzw. Android-App unter Einstellungen eintragen.

### 3. Optional: Gemini konfigurieren

Für die Titelerkennung kann ein Gemini API-Key hinterlegt werden.

- Android: in der App unter Einstellungen
- Desktop: in der App unter Einstellungen

Ohne Gemini funktioniert die Desktop-App weiterhin mit Tesseract-Fallback. Auf Android bleibt die manuelle Filmsuche nutzbar.

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

Lokaler Release-Build (ohne EAS Queue, Windows):

```bash
npm run android:build:production:local
```

Das erzeugte AAB liegt danach unter:

```text
apps/android/android/app/build/outputs/bundle/release/app-release.aab
```

Die Play-Console-Versionshinweise werden dabei aus [apps/android/play-store-release-notes.txt](apps/android/play-store-release-notes.txt) übernommen und als Kopie neben dem Bundle abgelegt.

## Releases

- Desktop-Pakete lassen sich mit `npm run desktop:package` erzeugen.
- Android-Builds lassen sich mit EAS über `eas build --platform android` erzeugen.
- Für GitHub Releases empfiehlt sich, die erzeugten Desktop-Artefakte oder Android-Builds erst nach einem verifizierten Tag hochzuladen und nicht im Repository selbst zu versionieren.

### Google Play (Android)

Vorbereitung (einmalig):

1. In der Google Play Console eine App mit dem Paketnamen `com.bluraykatalog` anlegen.
2. In Google Cloud ein Service-Konto erstellen und als JSON-Key herunterladen.
3. Das Service-Konto in der Play Console unter API-Zugriff mit dem Projekt verknüpfen.
4. Dem Service-Konto mindestens Rechte auf Release-Management (z. B. „Release Manager“) geben.

Build + Upload (Internal Testing):

```bash
cd apps/android
eas login
eas build --platform android --profile production
eas submit --platform android --profile production --key C:/ABSOLUTER/PFAD/google-play-service-account.json
```

Hinweise:

- Das Profil `production` in `apps/android/eas.json` ist auf den Play-Track `internal` konfiguriert.
- Da ein natives `apps/android/android`-Projekt vorhanden ist, kommen Paketname und Versionscode aus `apps/android/android/app/build.gradle`.
- Vor jedem neuen Upload `versionCode` in `apps/android/android/app/build.gradle` erhoehen.
- Fuer lokale Release-Builds mit Gradle wird eine eigene Signatur benoetigt:
	- Keystore einmalig erzeugen (im Ordner `apps/android/android`):
		- `keytool -genkeypair -v -keystore release-keystore.jks -alias release -keyalg RSA -keysize 2048 -validity 10000`
  - `apps/android/android/keystore.properties.example` nach `apps/android/android/keystore.properties` kopieren
  - Werte fuer `storeFile`, `storePassword`, `keyAlias`, `keyPassword` setzen
  - Keystore und `keystore.properties` nicht ins Repository committen
- Komfort-Skripte:
	- `npm run build:production`
	- `npm run build:production:local`
	- `npm run submit:production`
	- `npm run release:internal`

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

