# Détecteur d'étiquette Zebra (essai)

Vérifie qu'au moment où Diakonos imprime une étiquette, le CVC de la pièce est écrit en **texte**
dans l'impression (langage ZPL de la Zebra). Si oui, Sentinelle pourra savoir qu'une pièce est
faite **sans toucher à la base de Diakonos**.

Sur le PC de validation (Zebra en USB) :

1. Double-cliquer sur `Detecteur etiquette Zebra.exe`.
2. Répondre **Oui** à la fenêtre Windows (administrateur).
3. Dans Diakonos, **valider une pièce** (scanner le code-barre). L'étiquette sort normalement.
4. Le programme copie l'impression dans `etiquette_capturee.spl` à côté de lui, et dit s'il y voit
   un `CVC…` en clair.
5. Envoyer le fichier `etiquette_capturee.spl` (et `etiquette_resume.txt`).

Ce qu'il fait, et rien d'autre : il demande à l'imprimante de **garder un instant** ce qu'elle
imprime, lit cette impression, puis **remet l'imprimante comme avant**. Il ne lit aucune base,
n'envoie rien sur internet, ne tape rien dans Diakonos, ne garde aucun mot de passe.

Fabriquer : `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o "Detecteur etiquette Zebra.exe" .`
