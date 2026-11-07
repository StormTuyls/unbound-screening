import type { ResultBand, SessionView } from "@/lib/db/screening";

/**
 * Een screening per test in plaats van per uitkomst.
 *
 * De motor levert een rij per uitkomst: links, rechts, de asymmetrie en een
 * delta per zijde. Dat is de juiste vorm om in op te slaan en de verkeerde om
 * te lezen. Vijf rijen over dezelfde test lezen als een opsomming, niet als
 * een bevinding, en in de lokale databank is 247 van de 679 rijen een delta.
 *
 * Hier worden ze één blok: de zijden onder elkaar op dezelfde schaal, het
 * verschil ernaast, en de vorige waarde als annotatie bij de meting waar hij
 * bij hoort. Pure functies en geen React, zodat ze te testen zijn; de afdruk
 * doet hetzelfde nog met een eigen kopie, zie de opmerking onderaan.
 */

export type ResultRow = SessionView["results"][number] & {
  /** De testnaam in de taal van de lezer, opgelost door de pagina. */
  label: string;
};

/** Zelfde volgorde als in het rapport, zodat links nooit ergens rechts staat. */
const SIDE_ORDER = ["left", "right", "bilateral", "unknown"];

/**
 * Tot waar een band aandacht vraagt.
 *
 * Als deel van de schaal van DEZE regel en niet als score. Een score van 1 is
 * bij navicular_drop (twee banden) de beste uitkomst en bij een krachtregel
 * (vier banden) de op een na slechtste. Dezelfde breuk als in BandStrip, zodat
 * de streep langs een regel en de kleur in de figuur hetzelfde zeggen.
 */
export const ATTENTION_BELOW = 0.66;

/** Een stip op de strip. Spiegelt StripMarker in components/report/BandStrip. */
export interface Marker {
  value: number;
  label: string;
  previous?: number | null;
}

export interface Grouped {
  metricKey: string;
  label: string;
  block: string;
  /** De gemeten rijen, links voor rechts. Asymmetrie en delta horen er niet in. */
  sides: ResultRow[];
  asymmetry: ResultRow | null;
  /** De vorige waarde per zijde, uit de deltarijen gelicht. */
  previous: Map<string, number>;
  bands: ResultBand[] | null;
  markers: Marker[];
  coverRank: number | null;
  /** Null als er niets aan de hand is, anders hoe erg. */
  attention: "danger" | "warn" | null;
}

/**
 * Waar deze meting ligt op de schaal van haar regel, of null zonder band.
 *
 * Door te delen door de hoogste score in dezelfde bandenlijst klopt het voor
 * een regel met twee banden en voor een met vier.
 */
export function ratioOf(row: ResultRow): number | null {
  if (row.bandScore === null || row.bands === null) return null;
  const max = Math.max(0, ...row.bands.map((b) => b.score ?? 0));
  return max > 0 ? row.bandScore / max : null;
}

export function groupByMetric(rows: ResultRow[]): Grouped[] {
  const groups = new Map<string, Grouped>();

  for (const row of rows) {
    const group = groups.get(row.metricKey) ?? {
      metricKey: row.metricKey,
      label: row.label,
      block: row.block,
      sides: [],
      asymmetry: null,
      previous: new Map<string, number>(),
      bands: null,
      markers: [],
      coverRank: null,
      attention: null,
    };

    if (row.kind === "asymmetry") {
      group.asymmetry = row;
    } else if (row.kind === "delta") {
      if (typeof row.inputs?.previous === "number") {
        group.previous.set(row.side, row.inputs.previous);
      }
    } else {
      group.sides.push(row);
      // Eerst gevonden wint: een latere rij zonder banden mag ze niet wissen.
      group.bands = group.bands ?? row.bands;
      group.coverRank = group.coverRank ?? row.coverRank;
    }

    groups.set(row.metricKey, group);
  }

  for (const group of groups.values()) {
    group.sides.sort(
      (a, b) => SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side),
    );

    group.markers = group.sides
      .filter((row) => row.status === "computed" && row.value !== null)
      .map((row) => ({
        value: row.value as number,
        label:
          row.side === "left" || row.side === "right"
            ? row.side.slice(0, 1).toUpperCase()
            : "",
        previous: group.previous.get(row.side) ?? null,
      }));

    // De slechtste kant bepaalt of de test opvalt. Een rij zonder band telt
    // niet mee: die is vastgelegd maar niet beoordeeld, en dat is geen oordeel.
    const ratios = group.sides
      .map(ratioOf)
      .filter((ratio): ratio is number => ratio !== null);
    if (ratios.length > 0) {
      const worst = Math.min(...ratios);
      if (worst <= 0) group.attention = "danger";
      else if (worst < ATTENTION_BELOW) group.attention = "warn";
    }
  }

  return [...groups.values()];
}

/** Welke kant lager ligt, uit de teller en de noemer van de asymmetrie. */
export function asymDirection(row: ResultRow): "left" | "right" | null {
  const left = row.inputs?.left;
  const right = row.inputs?.right;
  if (typeof left !== "number" || typeof right !== "number" || left === right) {
    return null;
  }
  return left < right ? "left" : "right";
}

/**
 * De afdruk groepeert nog met zijn eigen kopie, over SnapshotResult in plaats
 * van over deze rij. Dat is met opzet niet in één keer rechtgetrokken: het
 * rapport rendert uitsluitend uit een bevroren versie en werkt, en die twee
 * types gelijktrekken is een eigen wijziging met een eigen risico.
 */
