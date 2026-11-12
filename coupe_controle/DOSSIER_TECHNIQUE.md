# Sentinelle — dossier technique de reprise

Document destiné à un développeur qui reprend le projet **Sentinelle** (contrôle de coupe
+ suivi de production, Laisné Industrie). Tout le code est dans ce dépôt ; ce document
explique à quoi sert chaque partie, comment on la fabrique, comment les morceaux communiquent,
et où continuer.

> Le dépôt contient aussi `oracle_budget/` (une autre application, sans rapport) et
> `suivi_production/` (une maquette, voir plus bas). Sentinelle = le dossier **`coupe_controle/`**.

---

## 1. Vue d'ensemble

Sentinelle contrôle la découpe de panneaux (cuisines) à partir des fichiers de l'atelier,
et suit l'avancement de la production. Il existe sous trois formes **qui partagent le même
code métier** :

- **PC** : une page web autonome (`coupe_controle/web/index.html`), empaquetée dans un `.exe`
  Windows qui sert la page en local et l'ouvre dans Chrome. C'est le poste principal.
- **Téléphone** : une application Android (`coupe_controle/android/`) qui est un **lecteur**
  de l'état partagé par le PC (plus, depuis la V6.3, quelques retours vers le PC).
- **Mini-site chiffré** (`coupe_controle/lien_telephone/`, Netlify) : relais qui transporte,
  **chiffré de bout en bout**, l'état du PC vers le téléphone (et les retours).

Depuis la **V6.4**, un quatrième morceau : l'**agent de validation**
(`coupe_controle/windows/outils/agent_validation/`), installé sur les PC de validation
(imprimante Zebra), pour le **suivi en direct** (étiquette imprimée = pièce faite).

Version courante : **6.6.0** (le PC et l'APK partagent le même numéro ; l'agent suit).

### Glossaire métier

| Terme | Sens |
|---|---|
| **CVC** | Identifiant d'une pièce dans Diakonos : `CVC` + 8 chiffres (commande), + n° de ligne. La clé d'une pièce = commande + ligne (ligne sur 3 chiffres). |
| **LAN** | Fichier de lancement (`LANssnnPOSTE.xlsx`, 37 colonnes) : les pièces à couper d'un lancement. **Jamais modifié** par Sentinelle (c'est la référence de la prod). |
| **Diakonos** | Le logiciel de gestion de l'atelier (pas « ERP »). On n'y accède **pas** en SQL sans accord du service informatique. |
| **Extraction** | Export Excel « Suivi production » de Diakonos (`suivi_production_JJMMAAAA.xlsx`) : les pièces qui restent à valider. |
| **Bibliothèque** | Base locale (IndexedDB) des semaines et de leurs lancements, scannés dans « Contrôler la coupe ». Source des pièces lancées. |
| **Cut Rite / .bkp** | Logiciel d'optimisation de coupe ; `.bkp` = projet contenant les plans de coupe (`.pct/.ptn/.brd`). |
| **pf** | Petit format (couleur) — géré par l'atelier, pas par Sentinelle. |
| **Casse** | Pièce cassée relancée. Suivie dans la semaine écrite dans le nom du lancement (`LAN2646CASSE` → semaine 46). |

---

## 2. Arborescence (ce qui compte)

```
coupe_controle/
├── sources/                      # SOURCES de travail (à modifier ici)
│   ├── web_src/                  # la page web en morceaux (assemblés ensuite)
│   │   ├── 01_moteur.js          # cœur : lecture LAN, clés de pièces (cleLigne), règles
│   │   ├── 03b_plans.js          # plans de coupe Cut Rite (.bkp)
│   │   ├── 04*_*.js              # contrôles, scan, Diakonos, sommaire, correction
│   │   ├── 06b_bibliotheque.js   # bibliothèque des semaines (IndexedDB) + fichier partagé
│   │   ├── 06d_telephone.js      # LIEN chiffré : code → canal/jeton/clé, envoi au mini-site
│   │   ├── 06g_retour_telephone.js # retour téléphone → PC (canal « retour »)
│   │   ├── 06h_validations.js    # V6.4 : réception des étiquettes validées (canaux « validations »)
│   │   ├── 06i_stock.js          # V6.5 : stock woodStore (brdlib.bdx) + chutes de strat réservées du rapport
│   │   ├── 07_ui.js              # interface (menu, pages), échappement HTML (echapper)
│   │   ├── 07i_suivi_production.js # SUIVI de production (calcul + écran) — gros module (IIFE SUIVI)
│   │   ├── 07j_etiquette_cvc.js  # V6.4 : décode l'étiquette Zebra (ZPL ^GFA) et LIT le CVC
│   │   ├── 08_style.css, 08a_polices.css, 09_body.html
│   ├── outils/                   # fabrication + TESTS
│   │   ├── assembler_web.py      # assemble web_src/ → web/index.html (porte la version)
│   │   ├── test_web*.js          # tests Playwright (navigateur réel)
│   │   ├── fabriquer_etiquette_test.py  # fabrique une fausse étiquette ZPL (test, anonyme)
│   └── LISEZMOI.md
├── web/                          # page ASSEMBLÉE + PWA (manifest, sw.js, icônes)
│   └── index.html                # LIVRÉE (générée par assembler_web.py — ne pas éditer à la main)
├── android/                      # application téléphone (Gradle, Java, Robolectric)
│   └── app/src/main/java/com/marinedouyere/sentinelle/*.java
├── windows/                      # lanceur .exe (Go) + ressources
│   ├── main.go, fenetre_windows.go, reseau.go, fabriquer.sh, ressources.py
│   └── outils/
│       ├── agent_validation/     # V6.4 : AGENT des PC de validation (Go)
│       └── detecteur_etiquette/  # outil d'essai (capture d'une étiquette Zebra)
├── lien_telephone/               # mini-site Netlify (relais chiffré)
│   └── netlify/functions/partage.mjs
├── claustra/                     # logiciel à part (fichier de lancement des claustras)
└── DOSSIER_TECHNIQUE.md          # ce fichier
```

`coupe_controle/web/android/` est une **ancienne** variante (ignorer) ; l'appli courante est
`coupe_controle/android/`.

---

## 3. Architecture et flux

```mermaid
flowchart LR
  subgraph PC["PC principal (Sentinelle.exe → page web dans Chrome)"]
    BIB["Bibliothèque (IndexedDB)\nsemaines + lancements"]
    SUIVI["Suivi de production\n(extraction Diakonos + validations)"]
  end
  LAN["Fichiers LAN (.xlsx)\n+ .bkp Cut Rite"] -->|scan, lecture seule| BIB
  EXTRACT["Extraction Diakonos\nsuivi_production_*.xlsx"] -->|lecture seule| SUIVI
  BIB -->|chiffré AES-GCM| MINISITE["Mini-site Netlify\n(stocke des fichiers illisibles)"]
  MINISITE -->|chiffré| TEL["Téléphone (APK)\nlecteur"]
  TEL -->|retours chiffrés| MINISITE
  subgraph VALID["PC de validation (×2, imprimante Zebra USB)"]
    AGENT["Agent de validation\nsurveille l'imprimante"]
  end
  ZEBRA["Étiquette imprimée\n(ZPL ^GFA = image)"] --> AGENT
  AGENT -->|étiquette chiffrée,\n1 canal par poste| MINISITE
  MINISITE -->|Sentinelle lit le CVC| SUIVI
```

### Le lien chiffré (PC ↔ téléphone ↔ agents)

Tout passe par le **mini-site** `https://sentinelle-laisne-0ysi8zpn.netlify.app/api/partage`.
Le site ne voit que des octets chiffrés. Le **code de liaison** (16 caractères, ~80 bits,
alphabet sans O/0/I/1) n'est **jamais** envoyé.

À partir du code `n` (normalisé majuscules + alphanumérique) :

- **canal** (où est le fichier) = `SHA-256("<but>:" + n)` → 32 hex.
  - fichier partagé : but `sentinelle-canal` → `06d_telephone.js` (`sentinelle-canal:n`).
  - retour téléphone : but `sentinelle-retour`.
  - validations poste P : but `sentinelle-validations:P` (P = 1..4).
- **jeton d'écriture** = `SHA-256("sentinelle-ecriture:" + n)` (le 1ᵉʳ écrivain d'un canal le fixe).
- **clé** = PBKDF2-HMAC-SHA256(mot de passe = `n`, sel = `sentinelle-laisne-industrie`,
  150 000 itérations, 32 octets) → AES-256-GCM.
- **paquet** = `"SNT1"` (4) + IV (12) + chiffré AES-GCM (avec le tag). Le contenu peut être gzip.

L'API (`partage.mjs`) : `GET ?canal=` → manifeste ; `GET ?canal=&version=&partie=i` → octets ;
`PUT …` (en-tête `X-Sentinelle-Jeton`) dépose une partie ; `POST ?canal=` publie le manifeste
et efface l'ancienne version. Taille par partie ≤ 5 Mo, ≤ 60 parties.

### Le fichier partagé (PC → téléphone)

`contenuFichierPartage()` (`06b_bibliotheque.js`) : `{ format, genere, par, colonnesPieces,
explications, semaines[], suiviProduction, retourTelephone, retourValidations }`.
Envoyé au canal « fichier » dès qu'il change (signature comparée). Le téléphone le lit.

### Le suivi en direct (V6.4, le point délicat)

Diakonos imprime l'étiquette d'une pièce **en image** (ZPL `^GFA`, compressé Z64 = zlib+base64) :
pas de texte, pas de code-barre exploitable. La chaîne :

1. **Agent** (`agent_validation/`, Go, sur le PC de validation) : surveille le dossier spool
   Windows (`C:\Windows\System32\spool\PRINTERS`, avec « conserver les documents imprimés »).
   À chaque nouvelle étiquette, il la met en file, la chiffre (même format SNT1 que le lien) et
   la **dépose sur son canal** (`sentinelle-validations:<poste>`). File locale + accusés.
2. **Sentinelle** (`06h_validations.js`) : interroge les canaux des postes (1..4) toutes les 8 s,
   déchiffre le lot, et pour chaque étiquette appelle `lireCvcEtiquette` (`07j`).
3. **Lecture du CVC** (`07j_etiquette_cvc.js`) : décode l'image `^GFA`, repère la ligne du CVC,
   lit les 8 chiffres **un par un** (police à pas fixe ; gabarits dessinés au canvas), puis
   **choisit la commande lancée** qui colle le mieux (recoupée avec la bibliothèque). Une lecture
   douteuse est **écartée** (jamais une mauvaise pièce). Renvoie `{ commande, ligne, cle, … }`.
4. **Intégration au suivi** (`07i`, dans `calculer`, depuis la 6.4.3) : **une étiquette = une pièce**.
   Pièces faites = ce que dit la dernière extraction **+ les étiquettes imprimées après elle**
   (`etiquettesEnDirect(heure de l'extraction)`), plafonné à la quantité de la ligne. L'heure d'une
   étiquette = son heure d'impression (l'agent la met dans l'identifiant `poste-secondes-compteur`).
   - **Dévalidation** : une étiquette d'avant l'extraction ne compte plus — l'extraction fait foi.
   - **Ré-impression** : compte, plafonnée à la ligne, corrigée par l'extraction suivante.
   - **Casse** : c'est l'extraction qui décide (Diakonos remet une pièce relancée « en cours »). Ne pas
     se fier à la date `maj` d'un lancement : elle est réécrite à chaque relecture de la semaine (une
     tentative 6.4.3 basée dessus passait toute la casse « à faire », corrigée en 6.4.4).
   - Un lancement hors extraction n'est suivi que par ses pièces étiquetées (le reste : à faire).
   Les étiquettes prises sont accusées dans le fichier partagé (`retourValidations.traitees`) pour que
   l'agent arrête de les renvoyer. Test autonome : `sources/outils/test_web_comptage.js`.
5. **Pièces de Diakonos hors lancement** (6.4.4) : les pièces de production de l'extraction qui ne sont
   dans aucun lancement de la bibliothèque (lancement pas scanné, pièces ajoutées après) forment une
   ligne « Pas dans un lancement » (poste « Diakonos ») par semaine Diakonos, avec le coloris de
   l'extraction (« Code Coloris », 11e case des lignes). Contrôle : « à faire » du suivi = somme
   « Qte en cours » de production de l'extraction (`test_web_suivi.js`).

Activité par poste et bouton « Réinitialiser » : `htmlBandeauValidations()` (06h) + `brancher()`
(07i). Chaque poste a un **nom** (ex. « Crédences ») envoyé dans son lot.

### Le stock des panneaux (V6.5, `06i_stock.js`)

- **Source** : `brdlib.bdx`, la bibliothèque de panneaux de woodStore, **extraite à la main** par
  l'atelier (lecture seule, aucun accès SQL). CSV en windows-1252, 20 colonnes. Utiles :
  0 code (commence par `X` = chute), 1 quantité, 2 matériau, 3-5 longueur/largeur/épaisseur,
  **7 Limite** (code woodStore : **0** = limité au stock, **9** = dépassement autorisé),
  9 désignation, 10 fil, **14 statut** (0 panneau entier, 1 chute disponible, **2 chute réservée**
  pour un lancement à débiter), 15 emplacements `case(qté) case(qté)` (liste parfois coupée par
  woodStore : la dernière parenthèse peut manquer), 17 famille.
- **Règle** : stock réel = stock − réservé. Les chutes réservées sont comptées et listées à part.
- **Liste (6.5.8)** : tous les matériaux par défaut, même à zéro (cas du 1136 à zéro, seul le 1136-PF en stock : il
  n'apparaissait pas). La case « avec du stock seulement » n'est plus cochée d'office ; cochée, un code tapé en
  entier s'affiche quand même.
- **Panneaux entiers réservés (6.5.7)** : woodStore range les panneaux entiers réservés pour un lancement
  dans la **case 302** (`CASES_RESERVATION`). Cas réel du 12/11 : 1063 = `302(3) 1042(21) 1043(24)` = 48
  en stock, **45** disponibles. Par format : `reserve` (case 302, jamais plus que la quantité) et
  `dispo` = qté − réservés ; par matériau : `nbEntiers` = disponibles, `nbEntiersReserves` à part. Le
  fichier partagé garde la quantité totale (index 1) et les cases (index 11) : le téléphone refait le même
  calcul (`FormatStock.reserve()` / `dispo()`), donc aucun changement de format.
- **Page Stock** (menu) : charger le fichier (gardé en mémoire du navigateur, `sentinelle-stock`),
  rechercher un matériau, détail (entiers, chutes disponibles, chutes réservées, cases, Limite),
  « chutes qui dorment » (> 120 jours), tri par clic sur les en-têtes de colonnes. Avertit si les
  données ont plus de 7 jours.
- **Téléphone** (6.5.1) : le stock part dans le fichier partagé, **déjà lu** (`stockPourPartage()`, une
  ligne par format : code, qté, matériau, L, l, ép., limite, désignation, fil, réservée, famille, cases,
  origine, depuis). Charger un nouveau fichier déclenche l'envoi (`signatureStock()` dans la signature
  d'envoi). Écran `EcranStock.java` (icône « panneaux empilés » de la barre du haut : le menu du bas est
  plein, 5 onglets au plus) : même contenu que le PC, tri par les en-têtes.
- **Rapport du lancement** : page « Chutes de stratifié réservées » (`partieChutesStratReservees`).
  Les chutes viennent des plans du `.bkp` du lancement (plans « chute du stock »), **stratifié
  seulement** (matériau `STRAT…` ou épaisseur ≤ 1,2 mm ; ni agglo ni compact). La **case** est lue
  dans le `.bkp` (lignes BRD3, relevées par woodStore à l'optimisation), à défaut dans le fichier de
  stock. Colonnes : case, couleur, désignation, longueur, largeur, quantité ; triées par case.
  Seules des **chutes** y figurent : les feuilles entières (dont RCB / RCB-CRED14) n'y sont pas, les
  chutes de RCB restent.
- **À venir** : simuler un lancement complet sur le stock.

### Vérifier un pré-lancement (V6.6, `06j_pre_lancement.js`)

- **Source** : la grille de l'écran « Lancement » de Diakonos exportée en Excel, une ligne par pièce, **19 colonnes sans
  en-tête** : Qté à lancer, Semaine (livraison), Commande, Ligne, Catalogue, Article, Désignation, Qte, Longueur,
  Largeur, Epaisseur (cotes finies), Code coloris, Coloris, Cp, Ville, com_transporteur, Transporteur, Blocage compta,
  Blocage fab. Un export avec une ligne de titres est lu par le nom des colonnes. Gardé en mémoire
  (`sentinelle-pre-lancement`). Page « Vérifier un pré-lancement » du menu (sous « Préparer un lancement »).
- **Contrôle avant lancement** : bloquée compta / fab, en double, qté à lancer > commande (rouge) ; **déjà lancée**
  (clé commande+ligne dans la bibliothèque, avec le lancement et la semaine), en retard (semaine < celle du
  pré-lancement) (orange) ; en avance, lancée en partie, à 0 (info) ; **plus grande que les panneaux en stock** (rouge :
  formats en stock ou Limite 9, chutes disponibles ; cas réel du 1136, pièces de 3 449 mm, seul le 2790 × 2060 en stock,
  le 4110 × 2060 à 0). La semaine du pré-lancement = celle du plus de pièces.
- **Ce que devient un article à la coupe** (matière d'âme, couches, dessous) : 1) **cas particuliers** saisis dans la
  page (`sentinelle-cas-particuliers` ; par défaut RENF391001 = 2 panneaux SMELBLALIS19 19 mm, un seul stratifié
  dessus, débit + 10 mm — à la main il faut mettre 2 agglos dans la liste de coupe) ; 2) **appris** dans la
  bibliothèque, (article + coloris) puis article : colonne « agglo », coloris_inf (rien / RCB… / décor = même décor),
  couches = épaisseur finie / épaisseur de la matière ; 3) règles par désignation et épaisseur, marquées « supposé ».
- **Simulation** : par matériau (décor dessus et son « -PF », âme, dessous), surface des pièces × m² de stock pris pour
  1 m² de pièces, **mesuré** sur les lancements de la bibliothèque qui ont leurs plans (panneaux entiers et chutes du
  stock, pas les modules ; mesuré en 2026 : stratifié ≈ 2,1, agglo ≈ 1,6, contrebalancement ≈ 1,9 ; défauts 2,0 / 1,55
  / 1,8). Comparé au **stock réel** (sans chutes réservées ni case 302) : OK (≤ 85 %), juste, il manque ≈ N panneaux
  (rouge si Limite 0 « Cut Rite ne pourra pas tout placer », orange si Limite 9 « à commander »), pas dans woodStore.
  C'est une estimation : l'optimisation réelle reste celle de Cut Rite.

### Lien PC → téléphone : savoir si le téléphone suit (V6.5.1)

Cas réel du 11/11 : le PC envoyait sur un **nouveau code**, le téléphone lisait toujours l'**ancien**
(dernière version : mardi) et ne disait rien. Trois parades :
- **Accusé de lecture** : après chaque nouvelle version lue, le téléphone dépose dans le canal retour
  `lectures: { appareil: { version, genere, quand } }` (`DemandesPc.lu / accuseAEnvoyer`, fusion avec un
  autre téléphone). Le PC le note par code (`noterLecturesTelephone`, `sentinelle-lectures-telephone`) et
  la carte Téléphone dit : « a bien reçu le dernier envoi », « n'a pas encore ouvert le dernier envoi »,
  ou « Aucun téléphone n'a encore lu ce code » (→ rescanner le QR code). Le PC garde la `version` publiée.
- **Code remplacé / envoi arrêté** : « Nouveau code » et « Arrêter » font un dernier envoi sur l'ANCIEN
  code avec `lien: "remplace"` / `"arrete"` (`prevenirAncienCode`). Le téléphone affiche un bandeau rouge
  sur tous les écrans, avec « Scanner le nouveau QR code du PC ».
- **Date des données** : l'écran Semaine du téléphone affiche « Données du PC du … ».
Le téléphone suit **un seul PC** : celui dont il a scanné le QR code.

**Le code tient (6.5.2)** : `Sentinelle.exe` garde le code dans `%LOCALAPPDATA%\Sentinelle\lien-telephone.json`
(route locale `/sentinelle/lien`, en-tête `X-Sentinelle: lien` obligatoire, `windows/memoire.go`, test
`memoire_test.go`). La page y recopie le code à chaque changement (`garderCodeDansLExe`) et le reprend au
démarrage si la mémoire de Chrome l'a perdu (`restaurerLienTelephone`, puis envoi). Sur la carte Téléphone,
« Reprenez son code » : on tape le code affiché dans l'appli (en gros sur la carte « Lien avec le PC ») et le PC
reprend ce code — le téléphone et les PC de validation n'ont rien à refaire (`reprendreCodeLienTelephone`).
« Créer un code » n'est que pour un premier téléphone. Test : `test_web_lien_tient.js`.

**Plusieurs PC sur le même code (6.5.3)** — cas réel du 12/11 : un PC au bureau et un PC à la maison, chacun
sa bibliothèque ; le téléphone ne voyait que celle du dernier PC qui envoyait. Désormais, avant chaque envoi et
toutes les 2 minutes, le PC relit le site (`reprendreDuSite`, `synchroniserAvecLeSite`) : si un AUTRE PC a publié
(version ≠ la sienne), ses semaines sont fusionnées (`fusionnerSemaines`, comme le Drive), avec son suivi
(`SUIVI.recevoir`) et son stock s'il est plus récent (`recevoirStockDistant`). Le prochain envoi contient les
lancements des deux PC. Le fichier partagé porte le nom du PC (`poste`, donné par `Sentinelle.exe` :
route `/sentinelle/poste`) ; l'appli affiche « Données du PC « X » du … ».

**Suivi : semaines de LIVRAISON (6.5.6)** — en semaine 46 du calendrier, on fabrique la livraison 47 : c'est la
semaine « en fabrication » (`resume.fabrication`, calendrier + 1) ; une livraison d'avant pas finie est en retard
(`ordreFab`). Les vues par semaine / transporteur / coloris / client rangent chaque pièce dans sa semaine de livraison
Diakonos (`livraisonCle`, colonne Semaine de la dernière extraction qui l'a), comme Diakonos ; une pièce sortie de
toutes les extractions garde la semaine de son lancement. Cas réel : JMC semaine 46 absente côté téléphone.
Noms de **Diakonos** dans les vues : transporteur Diakonos de la pièce (sinon de sa commande) ; pour une pièce déjà
faite, le nom du fichier de lancement ramené au nom Diakonos connu (`versDiakonos` : « LOG 4 T1 » → « LOG 4 T1
LAISNE ») ; une « dimension » en guise de transporteur (colonne décalée) est ignorée. Coloris : code Diakonos.
**Surplus** : si Diakonos a plus de pièces en cours que le lancement (pièce relancée, relance dans aucun lancement
scanné), le surplus va « à faire » dans « Pas dans un lancement » de sa semaine de livraison (`L.surplus`, ajouté dans
les totaux). Contrôle permanent : `test_web_suivi_diakonos.js <index> <extraction[+…]> <dossiers semaine…>` —
pièce par pièce, transporteur × semaine, semaine, coloris × semaine et tableau identiques à Diakonos (vérifié sur
les extractions réelles du 07/11, 10/11 et 12/11 : 0 écart). Les pièces d'un lancement comptent quel que soit leur
catalogue Diakonos (ex. Dibond d'un lancement chantier) ; hors lancement, la production seulement.

**Tout lancement des cases entre dans la bibliothèque (6.5.5)** — cause réelle du lancement du 10/11 absent du
téléphone : il était dans sa case sur le PC, mais un lancement n'entrait dans la bibliothèque (donc dans le fichier
envoyé) qu'après « Lancer les contrôles » de toute la semaine, un scan de dossier ou une validation. Le contrôle d'une
case seule et un fichier mis à la main ne l'y mettaient pas ; une semaine introuvable l'écartait sans message.
Désormais : fichier mis dans une case → `planifierArchivageValidations` (2 s) ; bouton du contrôle d'une case → idem ;
à l'ouverture → `archiverLancementsManquants()` (les cases des deux onglets absentes de la bibliothèque) ; semaine
introuvable → celle de l'onglet (`anneeDeLaSemaine`) ; un lancement qui ne peut pas entrer est noté dans
`bibliotheque.nonArchives` et affiché en rouge sur la carte Téléphone (« pas envoyé au téléphone »).
Test : `test_web_lancement_bibliotheque.js`.

**Rien ne reste en route (6.5.4)** : un changement non envoyé (Sentinelle fermée dans les 3 s qui suivent, envoi
raté…) part à l'ouverture suivante (`planifierEnvoiTelephone()` au démarrage) et à chaque synchro de 2 minutes
(signature ≠ celle du dernier envoi). La carte Téléphone liste ce qui est parti au dernier envoi (`etat.envoye` :
semaine → lancements). L'appli liste tous les noms de lancements dans la Bibliothèque (plus de coupure à 2 lignes).

**Stock : aucune limite d'affichage (6.5.3)** — PC et téléphone affichent tous les matériaux (le vrai fichier :
326 avec du stock), toutes les chutes, toutes les chutes qui dorment. Case « avec du stock seulement » (cochée).

### Clavier de l'APK (V6.5)

Les champs « Pièce ou commande », couleur (pièce sans étiquette) et coloris s'ouvrent sur le
**clavier numérique** ; un bouton « ABC » / « 123 » change de clavier (`PartageVue.boutonClavier`).
La clé de pièce d'un plan modifié se tape en chiffres : le préfixe `CVC` est ajouté tout seul
(`EcranPlans`, variable `clePiece`).

---

## 4. Fabrication (build)

Prérequis : Python 3 (+ Pillow pour les icônes), Node + Playwright (Chromium pré-installé),
Go ≥ 1.24, Gradle + JDK (pour l'APK).

```sh
# 1) Assembler la page web (OBLIGATOIRE après toute modif de web_src/)
cd coupe_controle
python3 -I sources/outils/assembler_web.py web/index.html sources/web_src web/index.html

# 2) .exe Windows de Sentinelle (lit la version dans web/manifest.webmanifest)
cd coupe_controle/windows && sh fabriquer.sh <dossier_de_sortie>

# 3) APK téléphone
cd coupe_controle/android && gradle --offline :app:assembleRelease
#    (tests : gradle --offline :app:testDebugUnitTest)

# 4) Agent de validation (Go, Windows)
cd coupe_controle/windows/outils/agent_validation
#    ressources (icône + manifeste « administrateur ») :
python3 -I ../../ressources.py ../../../web/icons/icon-512.png 1.0.0 rsrc_windows_amd64.syso "Agent validation" "Suivi en direct"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-s -w" -o "Agent validation Sentinelle.exe" .

# 5) Mini-site : déploiement Netlify du dossier coupe_controle/lien_telephone
```

### Où se trouve le numéro de version

À changer **ensemble** : `web/sw.js` (CACHE_NAME), `web/manifest.webmanifest`,
`sources/outils/assembler_web.py` (titre, avec une assertion), `sources/web_src/09_body.html`
(badge + pied de page), `android/app/build.gradle` (`versionName` + `versionCode`),
`windows/outils/agent_validation/main.go` (`versionAgent`).

---

## 5. Tests

Les tests Playwright chargent la vraie page dans Chromium et vérifient le comportement.
Beaucoup prennent en argument des **données client** (dossiers de lancement, extractions) qui ne
sont **pas** dans le dépôt : il faut les fournir localement.

```sh
cd coupe_controle/sources
node outils/test_web.js ../web/index.html <…dossiers semaine…>
node outils/test_web_suivi.js ../web/index.html <Semaine 47> <LAN…48.xlsx> <extraction.xlsx> <ref.json> <python> <fabriquer_extraction.py> <sortie> [capture] [Semaine 46]
# Comptage du suivi en direct (autonome, données fabriquées) :
node outils/test_web_comptage.js ../web/index.html
# Stock (autonome, fichier fabriqué) + page du rapport (optionnel : une vraie sauvegarde .bkp) :
node outils/test_web_stock.js ../web/index.html <sortie> [LAN…backup.bkp]
# Suivi en direct (autonome, données anonymes générées) :
node outils/test_web_etiquette.js ../web/index.html <python> outils/fabriquer_etiquette_test.py <sortie> [etiquette_reelle.spl]
# Agent (chiffrement/canal, se teste sur ce poste, sans Windows) :
cd ../windows/outils/agent_validation && go test ./...   # (ou test-envoyer / test-relire contre le vrai mini-site)
# Android (Robolectric) :
cd coupe_controle/android && gradle --offline :app:testDebugUnitTest
```

`test_web_etiquette.js` couvre la lecture du CVC (vraie étiquette + fausses anonymes) et le
rendu de l'écran Suivi **lien branché** (régression de la page blanche).

---

## 6. Règles métier à respecter (important)

- **Ne jamais modifier** le fichier LAN, la liste de coupe, ni le `.bkp` : ce sont les
  références de la production. Les corrections se font côté PC ; le téléphone n'est qu'un lecteur
  (ses retours sont **appliqués par le PC**).
- **Pas d'accès SQL** à Diakonos sans accord du service informatique ; ne jamais extraire
  d'identifiants. woodStore = lecture seule.
- **Données client** (LAN, extractions Diakonos, `.bkp`…) : **jamais** dans le dépôt. Les
  fixtures de test sont anonymisées.
- Textes d'interface : **français simple et court**. Dire « logiciel de gestion », pas « ERP ».
- La **version** ne doit pas apparaître dans le fichier généré par Sentinelle, mais doit être
  visible dans l'interface.
- Le PC et l'APK portent **le même numéro de version**.

---

## 7. Déploiement

- **PC principal** : remplacer `Sentinelle Vx.y.z.exe`. Il sert la page en local (127.0.0.1,
  port fixe) et l'ouvre dans Chrome (Edge à défaut). Mémoire par adresse locale.
- **Téléphone** : installer l'APK par-dessus (garde lien + réglages).
- **PC de validation (×2)** : installer `Agent validation Sentinelle.exe` (administrateur),
  `setup` (code de liaison = celui du téléphone + numéro + nom du poste). Démarrage auto par
  tâche planifiée au logon. Internet requis.
- **Mini-site** : Netlify, dossier `lien_telephone/`.

---

## 8. Reprise : points ouverts

- **Renforcer le mini-site** (laissé exprès pour ne pas casser le lien en service) : ajouter un
  **jeton de lecture** (un `GET` exige un en-tête dérivé du code), effacement automatique plus
  agressif des vieux canaux. À faire avec prudence (coordonné PC + téléphone + agent).
- **Agent** : capture réelle de la Zebra et démarrage auto à valider sur site (non testables hors
  atelier). Driver ZDesigner GK420t en mode graphique (étiquette = image) — si le modèle de la
  Zebra change et que la mise en page bouge, revalider `07j` (gabarits, repérage de la ligne CVC).
- L'historique du suivi en direct est gardé par navigateur (localStorage) ; le bouton
  « Réinitialiser » le vide (phase de dev).

---

## 9. Dépôt et accès

- Dépôt : **`marinedouyere-oss/logiciel-linux`** (GitHub).
- Branche de développement : **`claude/happy-ride-7x1yby`** (tout le travail récent y est).
- Donner accès au développeur : *Settings → Collaborators* du dépôt (ou l'équipe), en lecture
  ou écriture selon le besoin. Un développeur clone le dépôt et travaille sur la branche (ou en
  ouvre une nouvelle à partir d'elle).
