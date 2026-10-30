'use strict';

// Programme importé une fois, au premier lancement qui le trouve.
// [exercice, [séries, rép. min, rép. max], [[charge, rép.], …]] — null = inconnu,
// rép. min null = « max » ; sans séries données, l'exercice part de séries vides.
const PROGRAMME = {
  id: 'programme-2026-10-30',
  seances: [
    {
      name: 'Séance 1 — Poussée & jambes',
      exercices: [
        ['Presse à cuisses', [4, 8, 10]],
        ['Développé couché Smith légèrement incliné', [3, 8, 10], [[27.5, 9], [27.5, 9], [27.5, 8]]],
        ['Pec deck', [3, 12, 15], [[86, 14], [86, 13], [86, null]]],
        ['Élévations latérales', [3, 10, 15], [[10, 13], [10, 12], [10, 10]]],
        ['Barre au front', [2, 10, 12], [[7.5, 12], [7.5, 12]]],
        ['Leg curl', [3, 10, 12]],
        ['Mollets', [3, 10, 15]],
      ],
    },
    {
      name: 'Séance 2 — Largeur & dos',
      exercices: [
        ['Tractions lestées', [3, 8, 10], [[null, 11], [null, 11], [null, 10]]],
        ['Hammer Strength incliné', [3, 10, 12], [[50, 12], [50, 11], [50, 10]]],
        ['Rowing haltère', [3, 10, 12], [[34, 12], [34, 11], [34, 10]]],
        ['Soulevé de terre roumain', [3, 8, 10], [[25, 10], [25, 10], [25, 10]]],
        ['Pec fly inversé', [3, 15, 20], [[45, 20], [45, 18], [45, null]]],
        ['Élévations latérales', [3, 10, 15], [[10, null], [10, null], [10, null]]],
        ['Curl incliné', [3, 10, 12], [[14, 8], [12, null], [12, null]]],
      ],
    },
    {
      name: 'Séance 3 — Intensité',
      exercices: [
        ['Dips', [3, null, null], [[0, 16], [0, 16], [0, 12]]],
        ['Tirage vertical serré', [3, 10, 12], [[61, 12], [61, 10], [61, 10]]],
        ['Développé militaire', [3, 8, 10], [[28, 9], [28, 9], [28, 8]]],
        ['Élévations latérales à la poulie', [2, 12, 15]],
        ['Extension triceps au-dessus de la tête', [3, 10, 12]],
        ['Curl pupitre / barre EZ', [3, 10, 12]],
        ['Triceps corde', [2, 12, 15], [[17, 13], [17, 14]]],
        ['Curl marteau', [2, 12, 15], [[26, 12], [26, 12]]],
      ],
    },
  ],
};
