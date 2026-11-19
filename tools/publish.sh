#!/usr/bin/env bash
# Publish a built Devine-moi APK: GitHub release (Obtainium) + personal F-Droid repo.
#   ./tools/publish.sh            uses the version in package.json
# Needs: gh logged in, fdroid, the publishing clone ~/fdroid-repo (NOT ~/code/fdroid-repo, an old copy).
# Other uncommitted work in ~/fdroid-repo is set aside with `git stash` and restored at the end,
# so only Devine-moi and the regenerated index go into the commit.
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
APK="Devine-moi-v$V.apk"
FD=${FDROID_REPO:-$HOME/fdroid-repo}
PKG=com.freedomfighter.devinemoi
[ -f "$APK" ] || { echo "$APK missing: run ./build.sh"; exit 1; }

# 1. GitHub: repository (first time) and release
if ! gh repo view funkypitt/devine-moi >/dev/null 2>&1; then
  gh repo create funkypitt/devine-moi --public \
    --description "Le mot français du jour en six essais. Android, hors ligne, sans pub." --source . --remote origin
fi
git push -u origin main
git tag -f "v$V" && git push -f origin "v$V"
gh release view "v$V" >/dev/null 2>&1 || gh release create "v$V" "$APK" --title "Devine-moi $V" --notes-file <(git log -1 --format=%B | sed '/^Co-Authored-By/d')

# 2. F-Droid
cd "$FD"
git pull --ff-only
STASHED=0
if [ -n "$(git status --porcelain)" ]; then git stash push -u -m "set aside while publishing Devine-moi $V" && STASHED=1; fi
trap '[ $STASHED = 1 ] && git -C "$FD" stash pop' EXIT
cp "$OLDPWD/$APK" repo/
mkdir -p metadata/$PKG/en-US/images metadata/$PKG/fr-FR/images/phoneScreenshots
cp "$OLDPWD/fdroid/$PKG.yml" metadata/
convert "$OLDPWD/docs/icon-512.png" -resize 192x192 metadata/$PKG/en-US/images/icon.png
cp "$OLDPWD/docs/icon-512.png" metadata/$PKG/fr-FR/images/icon.png
cp "$OLDPWD"/fastlane/metadata/android/fr-FR/images/phoneScreenshots/*.png metadata/$PKG/fr-FR/images/phoneScreenshots/
fdroid update
git add -A metadata/$PKG.yml metadata/$PKG repo
git commit -m "Devine-moi $V — le mot français du jour en six essais"
git push
echo "Published Devine-moi $V"
