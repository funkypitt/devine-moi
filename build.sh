#!/usr/bin/env bash
# Devine-moi build: tests, www/, Capacitor sync, signed release APK.
#   ./build.sh            full build
#   ./build.sh --www-only only refresh www/
set -euo pipefail
cd "$(dirname "$0")"
node --test tests/*.test.js
python3 tools/build_words.py --selftest
rm -rf www && mkdir -p www
cp index.html styles.css devine-ui.css brouille.css app.js devine-core.js devine-ui.js snd.js words-fr.js brouille-data.js brouille.js www/
cp -r audio fonts www/
[ "${1:-}" = "--www-only" ] && exit 0
npx cap sync android
( cd android && ./gradlew assembleRelease -q )
V=$(node -p "require('./package.json').version")
cp android/app/build/outputs/apk/release/app-release.apk "Devine-moi-v$V.apk"
ls -la "Devine-moi-v$V.apk"
