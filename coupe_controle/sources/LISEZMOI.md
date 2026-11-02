# Sources de travail de Sentinelle

Ce dossier garde ce qui sert à fabriquer Sentinelle (aucune donnée client).

- `web_src/` : la page web en morceaux (scripts `01_…` à `07_…`, style, corps).
  La page livrée `coupe_controle/web/index.html` est leur assemblage :

  ```sh
  cd coupe_controle
  python3 -I sources/outils/assembler_web.py web/index.html sources/web_src web/index.html
  ```

  Le numéro de version est dans `web_src/09_body.html`, `outils/assembler_web.py`,
  `web/manifest.webmanifest` et `web/sw.js` (le .exe le lit dans le manifeste).

- `outils/` : scripts de fabrication et de test (Playwright, Python) : `test_web*.js`,
  `test_bandes_regles.js`, `verif_bandes4.py`, `verif_rouges.py`, `test_web_compte_rendu.js`,
  `test_web_lien_telephone.js`, `verif_exe.py`, `pdf_controles.js`…
  Les fichiers de lancement des clients qu'ils lisent ne sont jamais dans le dépôt.

- `.exe` : `cd coupe_controle/windows && sh fabriquer.sh <dossier>`.
- APK : `cd coupe_controle/android && gradle :app:assembleRelease`.
- Lien téléphone : `coupe_controle/lien_telephone` (site Netlify, fichier partagé chiffré).

## Claustra (logiciel à part)

Prépare le fichier de lancement des claustras (LAN…CLAUSTRA.xlsx, les 37 colonnes d'un lancement normal)
à partir de la confirmation de commande : lisses, lames (hauteur − 60), protection ; surcote 25, idPlan C ;
montage inclus → « A MONTER », non inclus → « ENKIT ».

- Sources : `coupe_controle/claustra/src/` ; page : `python3 -I coupe_controle/claustra/assembler.py 1.1 coupe_controle/claustra/index.html`.
- `.exe` : `cd coupe_controle/windows && sh fabriquer_claustra.sh <dossier>` (même lanceur que Sentinelle, port 47816).
- Test : `node sources/outils/test_claustra.js claustra/index.html web/index.html <sortie.xlsx> <capture.png>`.
