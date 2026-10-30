# SCU

Carnet de musculation pour téléphone. Séances, exercices, séries, charges — et un minuteur de repos.

- **Séance** : un nom, une date, des exercices. le `+` orange, puis `exercice` : on tape son nom, les exercices déjà faits sont proposés.
- **Série** : charge en kg, répétitions, un rond à toucher quand c'est fait.
- Les cases vides montrent en gris les valeurs de la dernière fois. Toucher le rond les valide telles quelles et lance le repos.
- **Repos** : `−` / `+` (15 s) règlent la durée par défaut à l'arrêt, ou le décompte en cours. Vibration et bip à la fin, écran maintenu allumé pendant le repos.
- Toucher le nom d'un exercice affiche son historique et son record.
- Hors ligne. Aucune dépendance, aucun compte, aucun serveur : les données restent sur le téléphone. `···` en haut de l'accueil → exporter / importer une sauvegarde.

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
