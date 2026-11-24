import { matchBand, scaleOf, type Band } from "@/lib/screening/bands";

/**
 * Wat er in de laatste screening het meest verschoven is.
 *
 * "Het meest" is gemeten op de schaal van de eigen regel, zoals BandStrip hem
 * tekent: een verschil van 2 graden is bij een heuprotatie niets en bij een
 * navicular drop in centimeter enorm. Gedeeld door het bereik van de drempels
 * is de grootte de afstand die je op de strip ziet, en dus vergelijkbaar
 * tussen metingen in verschillende eenheden.
 *
 * Alleen metingen met banden, en alleen tegen de meting ervoor onder hetzelfde
 * protocol. Over een protocolwissel heen is een verschil geen verschuiving maar
 * een ander instrument; zie lib/screening/baseline.ts.
 */

export type ShiftSide = "left" | "right" | "bilateral" | "unknown";
const SIDE_ORDER: readonly ShiftSide[] = ["left", "right", "bilateral", "unknown"];

export interface ShiftPoint {
  date: string;
  value: number;
  protocolId: string;
  side: ShiftSide;
}

export interface Shift {
  metricKey: string;
  /** Per zijde de vorige en de huidige waarde, met de band van de huidige. */
  sides: Array<{ side: ShiftSide; previous: number; value: number; band: Band | null }>;
  /** De grootste verschuiving over de zijden, als deel van de schaal. */
  size: number;
}

export function shiftsOn(
  date: string,
  metrics: ReadonlyArray<{ metricKey: string; points: readonly ShiftPoint[] }>,
  bandsFor: (metricKey: string) => Band[] | null,
): Shift[] {
  const shifts: Shift[] = [];

  for (const metric of metrics) {
    const bands = bandsFor(metric.metricKey);
    if (!bands) continue;
    const [lo, hi] = scaleOf(bands);

    const bySide = new Map<ShiftSide, ShiftPoint[]>();
    for (const point of metric.points) {
      bySide.set(point.side, [...(bySide.get(point.side) ?? []), point]);
    }

    const sides: Shift["sides"] = [];
    let size = 0;
    for (const [side, points] of bySide) {
      const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
      const current = sorted.at(-1);
      const previous = sorted.at(-2);
      if (!current || !previous || current.date !== date) continue;
      if (current.protocolId !== previous.protocolId) continue;

      sides.push({
        side,
        previous: previous.value,
        value: current.value,
        band: matchBand(current.value, bands),
      });
      size = Math.max(size, Math.abs(current.value - previous.value) / (hi - lo));
    }

    // Altijd links boven rechts, ongeacht de volgorde van de query.
    sides.sort((a, b) => SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side));
    if (size > 0) shifts.push({ metricKey: metric.metricKey, sides, size });
  }

  return shifts.sort((a, b) => b.size - a.size);
}
