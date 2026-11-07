# Vérification de l'appli native contre l'appli web

Les deux scripts calculent, avec l'appli web elle-même (servie sur
`http://localhost:8241/index.html`), les résultats que le moteur natif doit
reproduire à l'identique :

- `reference_js.js` : lecture des fichiers, contrôles, Contrôle Scies ;
- `reference_etape2.js` : scan du dossier partagé, recherche, schémas de commande.

```
NODE_PATH=<node_modules avec playwright> node reference_js.js <dossier des fichiers> <sortie>/reference.json
NODE_PATH=<node_modules avec playwright> node reference_etape2.js <dossier des fichiers> <sortie>/reference_etape2.json
SENTINELLE_FIXTURES=<dossier des fichiers> SENTINELLE_REFERENCE=<sortie>/reference.json gradle :moteur:test :app:testDebugUnitTest
```

Les fichiers réels de l'atelier et les références ne sont pas versionnés
(données clients) : sans eux, les tests concernés sont simplement ignorés.
