# Schéma technique — Plan de travail

Outil web autonome (HTML/CSS/JS, sans dépendance ni build) pour transformer
les cotes d'un plan de travail transmises par un client en un schéma
technique coté, prêt à imprimer ou à exporter.

## Fichiers

- `index.html` + `style.css` + `app.js` : code source (à éditer, à garder
  ensemble dans le même dossier — les chemins sont relatifs).
- `standalone.html` : le même outil en **un seul fichier** (CSS et JS
  intégrés). C'est celui à privilégier pour télécharger/partager/ouvrir sur
  mobile : les pièces jointes d'une conversation arrivent souvent isolées
  (pas de vrai dossier partagé), donc `index.html` seul ne trouve plus
  `style.css`/`app.js` et s'affiche sans mise en forme. `standalone.html`
  n'a pas ce problème, au prix d'être un peu plus lourd et moins pratique à
  éditer.

## Utilisation

Ouvrir `index.html` (ou `standalone.html`, voir ci-dessus) dans un
navigateur — aucune installation nécessaire :

1. Renseigner les informations client / chantier.
2. Optionnel : importer une photo ou un PDF du plan reçu du client comme
   repère visuel (ce fichier n'est ni enregistré, ni exporté — il sert
   uniquement pendant la saisie des cotes).
3. Choisir la forme (droit, en L, en U) et saisir les cotes en millimètres.
4. Décocher les bords qui ne sont pas contre un mur.
5. Ajouter les découpes (évier, plaque de cuisson...) si besoin, en
   précisant leur position sur le segment concerné.
6. Exporter en PNG, imprimer / exporter en PDF (via l'impression du
   navigateur), ou enregistrer / recharger le plan au format JSON.

Le dernier plan saisi est automatiquement sauvegardé dans le navigateur
(`localStorage`) et restauré à la prochaine ouverture.

## Limites connues

- Formes gérées : droit, en L, en U (pas de forme libre / polygone
  quelconque).
- Le plan reçu du client (photo/PDF) est un simple repère visuel affiché
  à l'écran : l'outil ne fait pas de reconnaissance automatique des cotes
  sur l'image, les mesures doivent être saisies manuellement.
