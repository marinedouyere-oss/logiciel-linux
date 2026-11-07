# Suivi de production (maquette, hors Sentinelle)

Tableau de bord de la production à partir de l'extraction **« Suivi production » de Diakonos** (.xlsx).

- Ouvrir `Suivi_production.html` (un seul fichier, marche sans internet) et y déposer l'extraction du jour.
- Tout est recalculé à chaque nouveau fichier : chiffres clés, tableau de contrôle par transporteur / catalogue /
  groupement / coloris / département et par semaine, charge par semaine, commandes en retard, détail filtrable,
  export CSV, et ce qui est sorti / arrivé depuis l'extraction précédente (gardée dans le navigateur).
- Le fichier est lu sur le PC : rien n'est envoyé, l'extraction n'est jamais modifiée.
- Les extractions Diakonos (données clients) ne vont jamais dans ce dépôt.

Fabriquer la page : `python3 -I outils/assembler.py` (reprend les polices et le logo de Sentinelle).
