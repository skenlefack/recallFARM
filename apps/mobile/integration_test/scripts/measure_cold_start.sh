#!/usr/bin/env bash
# Demarrage a froid (ENF de performance : < 3 s sur appareil 2 Go).
#
# Usage : measure_cold_start.sh <apk> [runs=10]
#   ADB=/chemin/vers/adb (defaut : adb du PATH)
#
# Methode : l'APK est installe, l'app lancee une fois (creation de la base
# chiffree, copie des packs), puis N lancements a froid : `am force-stop`, puis
# `am start -W`. FlutterActivity (rendu « surface ») retarde le premier dessin
# Android jusqu'a la premiere frame Flutter : TotalTime couvre donc le demarrage
# du processus, l'initialisation de main() (SQLCipher, session, packs,
# notifications) et la premiere frame affichee.
set -euo pipefail
APK="${1:?apk}"
RUNS="${2:-10}"
ADB="${ADB:-adb}"
PKG=app.recallfarm.recallfarm
ACT="$PKG/.MainActivity"

"$ADB" uninstall "$PKG" >/dev/null 2>&1 || true  # another signing key cannot update in place
"$ADB" install "$APK" >/dev/null
"$ADB" shell pm clear "$PKG" >/dev/null
echo "device: $("$ADB" shell getprop ro.product.model | tr -d '\r') API $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r'), RAM $("$ADB" shell cat /proc/meminfo | head -1 | tr -s ' ' | cut -d' ' -f2) kB"

# premier lancement (non compte) : creation de la base et des packs
"$ADB" shell am start -W -n "$ACT" >/dev/null
sleep 5

times=()
for i in $(seq 1 "$RUNS"); do
  "$ADB" shell am force-stop "$PKG"
  sleep 2
  t=$("$ADB" shell am start -W -n "$ACT" | tr -d '\r' | awk -F': ' '/TotalTime/{print $2}')
  times+=("$t")
  echo "run $i: ${t} ms"
  sleep 3
done
printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1; s+=$1} END {printf "min %d ms, mediane %d ms, max %d ms, moyenne %d ms (n=%d)\n", a[1], a[int((NR+1)/2)], a[NR], s/NR, NR}'
