# SCU

Carnet de musculation pour téléphone. Séances, exercices, séries, charges — et un minuteur de repos.

- **Séance** : un nom (facultatif), une date, des exercices.
- **Série** : charge en kg, répétitions, une coche quand c'est fait.
- Les cases vides proposent en gris les valeurs de la dernière fois. Cocher une série les valide telles quelles et lance le repos.
- **Repos** : `−15` / `+15` règlent la durée par défaut à l'arrêt, ou le décompte en cours. Vibration et bip à la fin, écran maintenu allumé pendant le repos.
- **Exercices** : historique complet et record par exercice.
- Hors ligne. Aucune dépendance, aucun compte, aucun serveur : les données restent sur le téléphone. `⋯` → exporter / importer une sauvegarde JSON.

## Installer sur le téléphone

L'app doit être servie en HTTPS. Le plus simple : GitHub Pages.

1. Fusionner la branche dans `main`.
2. *Settings → Pages → Build and deployment* : source **Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Ouvrir `https://adrienwittersheim.github.io/SCU/` sur le téléphone, puis
   - iPhone (Safari) : *Partager → Sur l'écran d'accueil* ;
   - Android (Chrome) : *⋮ → Installer l'application*.

GitHub Pages sur un dépôt privé demande un compte GitHub Pro. Sinon, rendre le dépôt public (il ne contient que le code, jamais les données), ou glisser le dossier sur [Netlify Drop](https://app.netlify.com/drop).

Installée sur l'écran d'accueil, l'app garde ses données durablement (Safari peut effacer celles d'un site simplement ouvert dans le navigateur).

## Développer

```sh
python3 -m http.server
```

puis ouvrir http://localhost:8000. Le service worker sert le cache puis le rafraîchit : une mise à jour apparaît au lancement suivant. Pour ajouter un fichier, l'inscrire dans `ASSETS` (`sw.js`) et incrémenter `CACHE`.
