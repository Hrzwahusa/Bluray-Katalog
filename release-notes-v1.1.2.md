# BluRay Katalog v1.1.2

## Highlights
- Improved Android library cover rendering.
- Reduced placeholder covers in gallery/list where image URLs are valid.
- Better resilience for Wikimedia-based cover links with retry handling.

## Android
- Fixed inconsistent cover loading where posters sometimes appeared in details but not in the library grid.
- Added safer cover URL normalization during library loading.
- Added one-time fallback retry for cover image failures in library tiles.
- Version updated to 1.1.2 (versionCode 14).

## Desktop
- Version updated to 1.1.2.
- New portable build prepared for release distribution.

## Build Artifacts
- Android APK: apps/android/android/app/build/outputs/apk/release/app-release.apk
- Desktop portable ZIP: apps/desktop/release/BluRay-Katalog-win-unpacked.zip

## Notes
- Desktop NSIS installer build can fail on systems without required symlink permissions.
- Portable desktop ZIP is available and validated as release artifact.
