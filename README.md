# Oracle Budget — client Linux

Client de bureau Linux (Python + PySide6/Qt) pour l'appli de suivi de
budget personnel **Oracle** (`com.oracle2015.budget` sur Android). Il se
connecte à **la même base de données Firebase** que l'appli mobile, donc
les données saisies sur l'un des deux appareils apparaissent sur l'autre
après synchronisation.

## Fonctionnalités

Reprises de l'appli Android d'origine :

- **Suivi** : revenus et charges du mois sélectionné, solde, mois clos,
  duplication vers le mois suivant, épargne automatique.
- **Delta** : plafond de solde visé et ajustements ponctuels du mois.
- **Mensuel** : vue récapitulative des 12 mois d'une année.
- **Annuel** : répartition des charges par catégorie (énergie, télécoms,
  impôts, assurances, enfants…) et suivi des prêts, en % des revenus.
- **Options** : connexion au compte Firebase, synchronisation manuelle,
  export JSON/CSV et import d'une sauvegarde JSON.

Les mois utilisent le même cycle budgétaire que l'appli Android (du 25 du
mois au 24 du mois suivant), et les montants sont formatés à la française
(`1 234,56 €`).

## Installation

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Lancement

```bash
python -m oracle_budget
```

Ou, après une installation en mode paquet (`pip install -e .`) :

```bash
oracle-budget
```

Un fichier `packaging/oracle-budget.desktop` est fourni pour l'intégrer au
menu des applications (à copier dans `~/.local/share/applications/`).

## Connexion et synchronisation

Le client utilise le **même projet Firebase** que l'appli Android
(mêmes identifiants de connexion e-mail/mot de passe). Dans l'onglet
**Options** :

1. Saisissez l'e-mail et le mot de passe de votre compte Oracle (le
   même que sur le téléphone), puis cliquez sur **Se connecter**.
2. Cliquez sur **Synchroniser maintenant** pour récupérer les dernières
   données. Après connexion, chaque modification est automatiquement
   renvoyée vers Firebase.

Tant que vous n'êtes pas connecté, l'appli fonctionne hors-ligne avec un
cache local (`~/.local/share/oracle-budget/oracle-data-v1.json`).

La clé d'API Firebase utilisée par défaut est celle intégrée dans l'appli
Android (c'est une clé cliente publique, pas un secret : la sécurité des
données repose sur les règles de la base Firebase, pas sur la
confidentialité de cette clé). Elle peut être surchargée par variables
d'environnement si besoin :

```bash
export ORACLE_FIREBASE_API_KEY=...
export ORACLE_FIREBASE_DATABASE_URL=...
export ORACLE_FIREBASE_SYNC_PATH=...
```

## Structure du projet

```
oracle_budget/
  models.py        modèle de données (Revenu, Charge, DeltaLine, Month, OracleData)
  dateutils.py      clés de mois, libellés de cycle
  format_utils.py   formatage monétaire français
  categories.py     catégorisation des charges
  firebase_client.py  client REST Firebase Auth + Realtime Database
  repository.py     cache local + synchronisation + opérations métier
  backup.py         export CSV
  ui/                interface PySide6 (fenêtre principale + 5 onglets)
```
