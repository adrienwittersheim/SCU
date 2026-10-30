# SCU

Carnet de musculation pour téléphone. Séances, exercices, séries, charges — et un minuteur de repos.

- **Séance** : une liste d'exercices qu'on refait. Chaque série garde la charge et les répétitions de la dernière fois.
- **Série** : charge et répétitions au clavier numérique ; changer la charge d'une série change aussi les suivantes. Toucher le rond valide la série et lance le repos. Les coches s'effacent d'elles-mêmes le lendemain.
- **Objectif** (`···` → objectif) : séries × fourchette de répétitions au clavier, par exemple `3 × 8–10`. Quand toutes les séries de la dernière fois ont atteint le haut de la fourchette, **↑ monter** s'affiche jusqu'à ce qu'une charge plus lourde soit choisie.
- Glisser une série vers la gauche la supprime (avec « annuler »).
- Appui long sur une série ou sur le nom d'un exercice, puis glisser : pour les réordonner.
- **Repos** : `−` / `+` (15 s) règlent la durée par défaut à l'arrêt, ou le décompte en cours. Vibration et bip à la fin, écran maintenu allumé pendant le repos.
- Toucher le nom d'un exercice affiche son historique et son record (séries validées).
- Hors ligne. Aucune dépendance, aucun compte, aucun serveur : les données restent sur le téléphone. `···` en haut de l'accueil → exporter / importer une sauvegarde.
- `programme.js` : programme ajouté une seule fois au premier lancement qui le trouve.

## Installer sur le téléphone

Publiée par GitHub Pages depuis `main` : https://adrienwittersheim.github.io/SCU/

- iPhone : ouvrir l'adresse dans Safari, *Partager → Sur l'écran d'accueil*.
- Android : ouvrir dans Chrome, *⋮ → Installer l'application*.

Installée sur l'écran d'accueil, l'app garde ses données durablement (Safari peut effacer celles d'un site simplement ouvert dans le navigateur).

## Développer

```sh
python3 -m http.server
```

puis ouvrir http://localhost:8000. À chaque publication, changer `VERSION` dans `sw.js` (et y inscrire tout nouveau fichier) : l'app installée se met à jour au lancement suivant.
