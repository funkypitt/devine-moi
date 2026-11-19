#!/usr/bin/env bash
# Render launcher icons and splash screens from the SVGs (needs inkscape + ImageMagick).
# Letters are converted to paths once (icon_foreground_paths.svg) so rendering needs no font.
set -euo pipefail
cd "$(dirname "$0")"
R=../android/app/src/main/res
[ -f icon_foreground_paths.svg ] || inkscape icon_foreground.svg --export-text-to-path --export-plain-svg -o icon_foreground_paths.svg
T=$(mktemp -d)
inkscape icon_background.svg -w 432 -h 432 -o $T/bg.png
inkscape icon_foreground_paths.svg -w 432 -h 432 -o $T/fg.png
convert $T/bg.png $T/fg.png -composite $T/full.png
declare -A L=( [mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192 )
declare -A F=( [mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432 )
for d in "${!L[@]}"; do
  n=${L[$d]}; f=${F[$d]}
  # legacy icon: the full-bleed art cropped to the 66/108 visible area, rounded square
  convert $T/full.png -gravity center -crop 300x300+0+0 +repage -resize ${n}x${n} \
    \( -size ${n}x${n} xc:none -draw "roundrectangle 0,0,$((n-1)),$((n-1)),$((n/5)),$((n/5))" \) -compose DstIn -composite $R/mipmap-$d/ic_launcher.png
  convert $T/full.png -gravity center -crop 300x300+0+0 +repage -resize ${n}x${n} \
    \( -size ${n}x${n} xc:none -draw "circle $((n/2)),$((n/2)) $((n/2)),0" \) -compose DstIn -composite $R/mipmap-$d/ic_launcher_round.png
  convert $T/fg.png -resize ${f}x${f} $R/mipmap-$d/ic_launcher_foreground.png
done
cat > $R/mipmap-anydpi-v26/ic_launcher.xml <<X
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_bg"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
X
cp $R/mipmap-anydpi-v26/ic_launcher.xml $R/mipmap-anydpi-v26/ic_launcher_round.xml
convert $T/bg.png -resize 432x432 $R/drawable/ic_launcher_bg.png
rm -f $R/drawable/ic_launcher_background.xml $R/drawable-v24/ic_launcher_foreground.xml
# splash: the foreground art centred on night blue
for dir in $R/drawable $R/drawable-port-* $R/drawable-land-*; do
  [ -f $dir/splash.png ] || continue
  sz=$(identify -format "%wx%h" $dir/splash.png); w=${sz%x*}; h=${sz#*x}; s=$(( (w<h?w:h) * 45 / 100 ))
  convert -size ${w}x${h} xc:'#0c1430' \( $T/fg.png -resize ${s}x${s} \) -gravity center -composite $dir/splash.png
done
convert $T/full.png -resize 512x512 ../docs/icon-512.png
rm -rf $T
echo icons done
