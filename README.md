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

- C'est un **fichier unique** (`index.html`, bibliothèques de lecture Excel et
  PDF incluses) : il suffit de le copier sur le poste Windows et de faire un
  double-clic pour l'ouvrir dans le navigateur (Edge, Chrome, Firefox…).
- La **liste de coupe** peut être un fichier Excel (comme avant) **ou un PDF**
  exporté directement depuis Cutrite (« Liste coupes »). Le PDF est même
  préférable quand il est disponible : il évite tout copier-coller manuel
  depuis l'écran Cutrite vers Excel, une étape qui pouvait introduire des
  erreurs de saisie invisibles pour le contrôle. Le fichier de lancement
  (STRAT), lui, reste toujours au format Excel.
- Tout se passe **localement dans le navigateur** : les fichiers STRAT et
  Cutrite ne sont jamais envoyés sur un serveur.
- Fonctionne **entièrement hors-ligne**, sans connexion internet.
- **Installable comme une application (PWA)**, avec icône et mode hors-ligne
  natif, en lançant `coupe_controle/web/server/lancer_sentinelle.bat`
  (double-clic) : ça démarre un petit serveur local via PowerShell, déjà
  présent sur Windows, sans rien à installer, puis ouvre
  `http://localhost:8080` dans le navigateur. Le navigateur propose alors
  d'« installer » Sentinelle (icône dans le menu Démarrer, fenêtre dédiée
  sans barre d'adresse). C'est nécessaire pour l'installation : les
  navigateurs bloquent cette fonctionnalité sur un fichier ouvert en
  double-clic direct (`file://`), donc **le simple `index.html` reste
  disponible tel quel** pour qui préfère ne rien lancer. Ce serveur
  n'écoute que sur le PC lui-même (`localhost`) : aucun autre appareil ne
  peut s'y connecter, par choix — pas de connexion ni de synchronisation
  entre appareils.
- **Sur téléphone** : c'est un outil complètement indépendant du PC, sans
  aucune connexion entre les deux. Deux façons de faire, au choix :
  - Copier `index.html` sur le téléphone (USB, e-mail…) et l'ouvrir
    directement dans Chrome — même fonctionnement que sur PC, mais sans
    icône d'appli dédiée (ça s'ouvre comme une page dans le navigateur).
  - Installer `coupe_controle/web/android/` (voir plus bas) : une vraie
    appli Android avec icône, qui embarque le même `index.html` et ne
    demande **aucune permission** (ni Internet, ni réseau, ni stockage) —
    impossible pour elle de se connecter à quoi que ce soit, y compris au
    PC.

### Appli Android native — Sentinelle (sans navigateur, sans réseau)

`coupe_controle/web/android/` est un habillage natif minimal (WebView) qui
embarque le même `index.html` déjà autonome : mêmes règles de contrôle,
même export Excel, mais avec une vraie icône installée et sans barre
d'adresse. Le manifeste ne déclare **aucune permission** — en particulier
pas `INTERNET` — donc l'appli ne peut techniquement se connecter à rien,
ce qui garantit qu'aucune donnée ne peut en sortir ni y entrer par le
réseau.

Pour générer l'APK (nécessite le SDK Android + JDK 17, pas fourni ici) :

```bash
cd coupe_controle/web/android
echo "sdk.dir=/chemin/vers/android-sdk" > local.properties
./gradlew assembleDebug   # ou `gradle assembleDebug` si le wrapper n'est pas présent
```

L'APK généré (`app/build/outputs/apk/debug/app-debug.apk`) se copie sur le
téléphone (USB, e-mail…) puis s'installe en autorisant temporairement
« Installer des applications inconnues » pour la source utilisée — c'est
une appli non publiée sur le Play Store, donc Android demande cette
confirmation, comme pour n'importe quel APK installé hors store.
- **5 postes fixes** pouvant être contrôlés en une seule fois : *Agglo 1er
  tour*, *Feno*, *Casse*, *Agglo 2ème tour*, *Chantiers*. Chaque poste
  débite 2 lancements en parallèle, traités comme 2 contrôles indépendants
  (chacun avec son propre fichier STRAT et sa propre liste de coupe) — soit
  10 comparaisons possibles en une fois. Les cases laissées vides sont
  simplement ignorées au lancement.
- Un panneau de **progression** affiche l'avancement poste par poste
  pendant le traitement (lecture STRAT → lecture coupe → comparaison →
  terminé/anomalies). Chaque résultat s'affiche dès qu'il est prêt, sans
  attendre les autres.
- Une **recherche de grain matching unique**, tout en haut de la page,
  interroge en une fois toutes les listes de coupe sélectionnées (pas
  besoin d'avoir lancé le contrôle au préalable).
- Pour les pièces **« En trop »** (trouvées dans la liste de coupe mais
  absentes du fichier de lancement), le numéro de commande et la ligne sont
  déduits directement de la clé commande+ligne, pour rester identifiables
  même sans correspondance STRAT.
- Quand une même clé commande+ligne est débitée en **plusieurs lots**
  (nesting sur plusieurs panneaux), la quantité réelle est calculée en
  sommant la colonne quantité de la liste de coupe (détectée automatiquement
  par comparaison avec les quantités du fichier de lancement) plutôt qu'en
  comptant « 1 pièce par ligne », ce qui évite de fausses anomalies.
- Une colonne + valeur supplémentaire (ex. un indicateur oui/non) est aussi
  détectée automatiquement pour exclure les lignes techniques de réserve/
  chute qui porteraient par erreur le même type de trace que la vraie
  pièce.
