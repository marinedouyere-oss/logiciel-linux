#!/bin/sh
# Fabrique « Claustra VX.Y.exe » (Windows 64 bits), le logiciel à part qui prépare le fichier de lancement
# des claustras. Même lanceur que Sentinelle (ce dossier), avec son nom et son propre port : les deux
# logiciels peuvent être ouverts en même temps. Le dossier de Sentinelle n'est pas touché (fabrication
# dans un dossier temporaire).
# Usage : sh fabriquer_claustra.sh [dossier de sortie]
# Il faut Go (1.21 ou plus) et Python 3 avec Pillow (pour l'icône).
set -e
version=1.0
ici=$(cd "$(dirname "$0")" && pwd)
sortie=${1:-$ici}
claustra="$ici/../claustra"
web="$ici/../web"
travail=$(mktemp -d)
trap 'rm -rf "$travail"' EXIT

# Le lanceur (sources Go) et la page Claustra, gardée dans le .exe.
cp "$ici"/*.go "$ici/go.mod" "$ici/ressources.py" "$travail/"
mkdir -p "$travail/page"
python3 -I "$claustra/assembler.py" "$version" "$travail/page/index.html"

# Icône Laisné, fiche « Propriétés » (version, nom) et manifeste du .exe.
cd "$travail"
python3 -I ressources.py "$web/icons/icon-512.png" "$version" rsrc_windows_amd64.syso Claustra "Fichier de lancement des claustras"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w -H windowsgui -X main.version=$version -X main.nomLogiciel=Claustra -X main.portTexte=47816" \
  -o "$sortie/Claustra V$version.exe" .
echo "$sortie/Claustra V$version.exe"
