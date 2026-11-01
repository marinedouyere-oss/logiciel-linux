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
