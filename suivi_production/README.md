# Suivi de production (maquette, hors Sentinelle)

Tableau de bord de la production à partir de l'extraction **« Suivi production » de Diakonos** (.xlsx).

- Ouvrir `Suivi_production.html` (un seul fichier, marche sans internet) et y déposer l'extraction du jour.
- Plusieurs extractions (ex. production + fournitures) : choisies ensemble ou ajoutées ensuite (« + Ajouter un
  fichier Diakonos ») ; une ligne présente dans deux fichiers (commande + ligne + n° de lancement) compte une fois.
- Aucune ligne n'est écartée : toutes les feuilles qui ont le tableau sont lues, une semaine vide / à 0 / illisible
  va dans « Sans semaine », une ligne sans commande est gardée. Le message de chargement donne le contrôle
  « N lignes prises en compte sur N lues », à comparer avec Diakonos.
- Tout est recalculé à chaque nouveau fichier : chiffres clés, tableau de contrôle par transporteur / catalogue /
  groupement / coloris / département et par semaine, charge par semaine, commandes en retard, détail filtrable,
  export CSV, et ce qui est sorti / arrivé depuis l'extraction précédente (gardée dans le navigateur).
- Comptage : une ligne de commande = commande + n° de ligne (Diakonos la répète à chaque n° de lancement, avec la
  même quantité : elle compte une fois). La résine (Méganite) est en m², le reste en pièces : jamais additionnés.
- Panneau « Contrôle » : lignes et sommes brutes (comme dans Excel) à côté de ce qui est compté.
- Le fichier est lu sur le PC : rien n'est envoyé, l'extraction n'est jamais modifiée.
- Les extractions Diakonos (données clients) ne vont jamais dans ce dépôt.

Fabriquer la page : `python3 -I outils/assembler.py` (reprend les polices et le logo de Sentinelle).
