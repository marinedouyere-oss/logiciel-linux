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

## Contrôle de coupe

`coupe_controle/` est un second outil de bureau (PySide6), indépendant
d'Oracle Budget, qui compare :

- le **fichier de lancement** (export STRAT de l'ERP, une ligne par pièce
  commandée, avec sa quantité) ;
- la **liste de coupe** générée par Cutrite (Homag) pour l'optimisation de
  débit (une ligne par panneau réellement découpé, chutes comprises).

Les deux fichiers sont rapprochés via la clé `commande+ligne` de chaque
pièce, ce qui permet de détecter les pièces manquantes, en trop, ou en
écart de quantité entre ce qui a été lancé et ce qui a réellement été
débité.

Lancement :

```bash
python -m coupe_controle
```

Ou, après une installation en mode paquet (`pip install -e .`) :

```bash
coupe-controle
```

Dans la fenêtre : sélectionnez le fichier STRAT et la liste de coupe,
cliquez sur **Lancer le contrôle**, puis exportez le rapport détaillé en
Excel si besoin.

### Version web autonome — Sentinelle (Windows, sans Python)

`coupe_controle/web/index.html` (« Sentinelle ») est une réimplémentation en
HTML/JavaScript de ce même contrôle (mêmes règles de rapprochement, mêmes
couleurs, même export Excel), pour les postes Windows où l'on ne veut pas
installer Python.

- C'est un **fichier unique** (bibliothèque de lecture/écriture Excel
  incluse) : il suffit de le copier sur le poste Windows et de faire un
  double-clic pour l'ouvrir dans le navigateur (Edge, Chrome, Firefox…).
- Tout se passe **localement dans le navigateur** : les fichiers STRAT et
  Cutrite ne sont jamais envoyés sur un serveur.
- Fonctionne **entièrement hors-ligne**, sans connexion internet.
- **5 postes fixes** pouvant être contrôlés en une seule fois (chacun avec
  son propre fichier STRAT + sa propre liste de coupe) : *Agglo 1er tour*,
  *Feno*, *Casse*, *Agglo 2ème tour*, *Chantiers*. Les postes laissés vides
  sont simplement ignorés au lancement.
- Un panneau de **progression** affiche l'avancement poste par poste
  pendant le traitement (lecture STRAT → lecture coupe → comparaison →
  terminé/anomalies).
- Pour les pièces **« En trop »** (trouvées dans la liste de coupe mais
  absentes du fichier de lancement), le numéro de commande et la ligne sont
  déduits directement de la clé commande+ligne, pour rester identifiables
  même sans correspondance STRAT.
