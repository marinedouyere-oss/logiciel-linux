#!/bin/sh
# Fabrique « Sentinelle VX.Y.Z.exe » (Windows 64 bits) à partir de la page web/index.html.
# Usage : sh fabriquer.sh [dossier de sortie]
# Il faut Go (1.21 ou plus), rien d'autre.
set -e
ici=$(cd "$(dirname "$0")" && pwd)
sortie=${1:-$ici}
web="$ici/../web"
version=$(sed -n 's/.*"name": "Sentinelle V\([0-9.]*\) .*/\1/p' "$web/manifest.webmanifest")
[ -n "$version" ] || { echo "version introuvable dans manifest.webmanifest" >&2; exit 1; }
grep -q "Sentinelle V$version" "$web/index.html" || { echo "index.html n'est pas en V$version" >&2; exit 1; }

# La page, son manifeste et ses icônes, gardés dans le .exe.
rm -rf "$ici/page"
mkdir -p "$ici/page/icons"
cp "$web/index.html" "$web/manifest.webmanifest" "$ici/page/"
cp "$web/icons/icon-192.png" "$web/icons/icon-512.png" "$ici/page/icons/"

# Icône Laisné et fiche « Propriétés » du .exe : à venir (fichier ressources .syso).
cd "$ici"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui -X main.version=$version" -o "$sortie/Sentinelle V$version.exe" .
echo "$sortie/Sentinelle V$version.exe"
