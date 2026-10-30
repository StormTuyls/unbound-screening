// Voorbeeld van de afkapwaarden, met verzonnen getallen.
//
// De echte bibliotheek komt uit de Screening 2025-bestanden van de praktijk en
// staat met opzet niet in git. Kopieer dit bestand om te kunnen bouwen:
//
//   cp lib/screening/afkapwaarden.voorbeeld.ts lib/screening/afkapwaarden.ts
//
// Drie tests, genoeg om elke vorm te laten zien: vier banden per zijde, twee
// banden, en een test zonder regel waarbij de tester zelf scoort.

import { type Library, BOUNDARY, SOURCE, simple } from "./libraryShape";

/** Staat op true in het echte bestand. Zie library.ts. */
export const ECHT = false;

export const PARTS: Library[] = [
  simple({
    key: "voorbeeld.hoek_per_zijde",
    block: "voorbeeld",
    sortOrder: 1,
    nl: "Voorbeeldhoek",
    en: "Example angle",
    laterality: "per_side",
    unit: "deg",
    direction: "higher_better",
    protocolConfirmed: true,
    bands: [
      { status: "poor", score: 0, lt: 10 },
      { status: "fair", score: 1, gte: 10, lt: 20 },
      { status: "good", score: 2, gte: 20, lt: 30 },
      { status: "excellent", score: 3, gte: 30 },
    ],
    note: `Verzonnen getallen. ${BOUNDARY}`,
  }),

  simple({
    key: "voorbeeld.afstand_twee_banden",
    block: "voorbeeld",
    sortOrder: 2,
    nl: "Voorbeeldafstand",
    en: "Example distance",
    laterality: "per_side",
    unit: "cm",
    direction: "lower_better",
    protocolConfirmed: true,
    bands: [
      { status: "normal", score: 1, lt: 5 },
      { status: "attention", score: 0, gte: 5 },
    ],
    note: `Verzonnen getallen, twee banden. ${BOUNDARY} Bron zou hier staan: ${SOURCE}.`,
  }),

  simple({
    key: "voorbeeld.score_zonder_regel",
    block: "voorbeeld",
    sortOrder: 3,
    nl: "Voorbeeldscore",
    en: "Example score",
    laterality: "bilateral",
    unit: "score",
    direction: "higher_better",
    protocolConfirmed: false,
  }),
];
