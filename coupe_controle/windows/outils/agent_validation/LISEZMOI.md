# Agent de validation Sentinelle (suivi en direct)

Sur chaque PC de validation (imprimante Zebra en USB), cet agent surveille l'imprimante en continu.
À chaque étiquette qui sort (= pièce faite), il l'envoie **chiffrée** au mini-site de Sentinelle (le
même lien que le téléphone). Sentinelle la reçoit, lit le CVC écrit sur l'étiquette et marque la pièce
faite tout de suite — PC et téléphone.

Il ne lit **aucune base** Diakonos, n'envoie rien d'autre, ne garde aucun mot de passe. Tout est chiffré
avec le code de liaison ; le code n'est jamais transmis.

## Installation (une fois par PC, en administrateur)
1. `Agent validation Sentinelle.exe` → double-clic → « Oui » (administrateur).
2. `setup` : entrer le **même code de liaison** que le téléphone, et le **numéro du poste** (1 ou 2).
   - active « Conserver les documents imprimés » sur la Zebra,
   - crée une tâche planifiée qui lance l'agent à chaque ouverture de session (plus de « Oui » ensuite).
3. L'agent tourne ensuite tout seul (`run`) en fond.

## Commandes
- `setup` : réglage (code + poste), démarrage automatique.
- `run` : la surveillance (lancée toute seule au logon).
- `test-envoyer CODE POSTE etiquette.spl…` : essai d'envoi.
- `test-relire CODE POSTE` : relit ce qui a été déposé.

## Fabriquer
`GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o "Agent validation Sentinelle.exe" .`
(ressources Windows — icône Laisné + demande administrateur — via ../../ressources.py avec le niveau
« requireAdministrator ».)
