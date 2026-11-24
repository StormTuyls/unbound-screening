/**
 * De blokken van een screening, in de volgorde waarin een behandelaar ze
 * afwerkt. De namen staan in de berichtencatalogus onder screening.blocks.
 */
export const TEST_BLOCKS = [
  "anthropometry",
  "mobility_ll",
  "mobility_ul",
  "core",
  "movement_ll",
  "forcedecks",
  "strength_ul",
] as const;

export type TestBlock = (typeof TEST_BLOCKS)[number];

/**
 * Een sleutel uit een testnaam: "Heup-endorotatie (zit)" wordt "heup_endorotatie_zit".
 * Accenten vallen weg, al de rest wordt een underscore.
 */
export function slugOf(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "test"
  );
}
