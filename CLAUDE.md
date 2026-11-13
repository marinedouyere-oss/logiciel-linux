# Sentinelle — consignes pour Claude

Ce dépôt contient **Sentinelle**, le logiciel de contrôle de coupe et de suivi de production de l'atelier
Laisné Industrie (plans de travail). Tout est dans `coupe_controle/` ; le fonctionnement complet est expliqué
dans **`coupe_controle/DOSSIER_TECHNIQUE.md`** : le lire avant toute modification.

- **Branche de travail : `claude/happy-ride-7x1yby`.** La branche par défaut du dépôt n'est pas celle-là :
  vérifier qu'on est dessus avant de commencer.
- Version actuelle : **6.9.6** (PC et téléphone portent toujours le même numéro).
- PC : page web `coupe_controle/web/index.html` (assemblée depuis `sources/web_src/`) servie par
  `Sentinelle Vx.y.z.exe` (`windows/`). Téléphone : APK Android (`android/`), **lecteur seul** : ses demandes
  sont appliquées par le PC. Lien PC → téléphone : mini-site Netlify chiffré (`lien_telephone/`).

## Règles de l'utilisatrice (à respecter absolument)

- Répondre **court, en français simple**. Dire « logiciel de gestion », jamais « ERP ».
- **Interdiction absolue de rajouter quoi que ce soit au LAN.** Ne jamais modifier les fichiers LAN, les
  listes de coupe ni les `.bkp` : ce sont les références de la production.
- Diakonos : **aucun accès SQL** sans l'accord du service informatique ; ne jamais extraire d'identifiants ;
  woodStore en lecture seule ; aucun mot de passe dans la conversation, le code ou un fichier partagé.
- **Fichiers clients** (LAN, `.bkp`, extractions Diakonos, stock `brdlib.bdx`…) : **jamais dans le dépôt**.
- PC et APK : **même numéro de version** (voir « Où se trouve le numéro de version » dans le dossier technique).
- Pas d'identifiant de modèle d'IA dans les commits.
- « pf » = petit format. Ne pas toucher l'« id plan ». Ne pas ajouter de limite d'affichage non demandée.
- Les semaines sont **toujours des semaines de livraison**. Suivi de production : la semaine la plus récente d'abord.
- Quand l'utilisatrice dit que quelque chose ne marche pas : la croire et chercher jusqu'à trouver.
- **Livraison** : le `.exe` (zippé) et l'APK dans `livraison/` (liens « raw » GitHub de la branche) **et**
  envoyer les fichiers directement dans la conversation. Garder aussi dans `livraison/` le zip de l'Agent de
  validation (`Agent_validation_Sentinelle_<version>.zip`, version à part : `versionAgent` dans
  `windows/outils/agent_validation/main.go`), à refaire seulement quand son code change.

## Fabriquer et tester (détails : dossier technique, parties 4 et 5)

```sh
cd coupe_controle
python3 -I sources/outils/assembler_web.py web/index.html sources/web_src web/index.html   # après toute modif de web_src
cd android && gradle --offline -q :app:assembleRelease      # APK ; tests : :app:testDebugUnitTest
cd windows && sh fabriquer.sh <dossier de sortie>           # .exe (python avec Pillow dans le PATH), puis le zipper
```

Les tests web (`sources/outils/test_web_*.js`, Playwright) ont besoin des **données de test**, qui ne sont pas
dans le dépôt : elles sont dans le paquet « Sentinelle_donnees » remis à l'utilisatrice (dossier
`donnees_de_test/`, avec `lancer_tests.sh` et `tests_apres.sh`, voir son `LISEZ-MOI.md`). Échec connu et ancien :
`test_web` « rapport casse : 3 pages ».

## Historique

L'historique des versions est dans `git log` (un commit par version) et dans le dossier technique. La
conversation complète avec l'utilisatrice depuis le début du projet est dans le paquet « Sentinelle_reprise »
(`conversation_sentinelle.md`), si elle le fournit.
