import assert from "node:assert/strict";
import { type ShiftPoint, shiftsOn } from "../../lib/screening/shift";
import type { Band } from "../../lib/screening/bands";

/**
 * "Wat is verschoven": de volgorde moet over eenheden heen kloppen, en een
 * verschil over een protocolwissel of tegen een oude meting telt niet.
 */

// Drempels 70 en 80 graden, een kwart marge aan elke kant: 67,5 tot 82,5, dus 15 breed.
const hip: Band[] = [
  { status: "poor", score: 0, lt: 70 },
  { status: "fair", score: 1, gte: 70, lt: 80 },
  { status: "good", score: 2, gte: 80 },
];
// Eén drempel op 1 cm: schaal 0,75 tot 1,25, dus 0,5 breed.
const drop: Band[] = [
  { status: "normal", score: 1, lt: 1 },
  { status: "attention", score: 0, gte: 1 },
];

const p = (date: string, value: number, side: ShiftPoint["side"] = "left", protocolId = "v1") => ({
  date,
  value,
  side,
  protocolId,
});

const bands = (key: string) => (key === "hip" ? hip : key === "drop" ? drop : null);
const today = "2026-11-20";

// 10 graden op een schaal van 15 is 0,67. 0,4 cm op een schaal van 0,5 is 0,8.
// De kleinere eenheid wint, want op zijn eigen strip bewoog hij verder.
{
  const shifts = shiftsOn(
    today,
    [
      { metricKey: "hip", points: [p("2026-09-01", 72), p(today, 82)] },
      { metricKey: "drop", points: [p("2026-09-01", 1.2), p(today, 0.8)] },
    ],
    bands,
  );
  assert.deepEqual(shifts.map((s) => s.metricKey), ["drop", "hip"]);
  assert.equal(shifts[0].size.toFixed(2), "0.80");
  assert.equal(shifts[0].sides[0].band?.status, "normal");
}

// Per zijde, en de grootste zijde telt.
{
  const [shift] = shiftsOn(
    today,
    [{ metricKey: "hip", points: [p("2026-09-01", 75, "right"), p(today, 85, "right"),
                                  p("2026-09-01", 75, "left"), p(today, 76, "left")] }],
    bands,
  );
  assert.deepEqual(shift.sides.map((s) => s.side), ["left", "right"]);
  assert.equal(shift.size, 10 / 15);
}

// Niet meegeteld: een protocolwissel, een meting die niet van vandaag is, een
// eerste meting, geen verschil, en een metriek zonder banden.
{
  const shifts = shiftsOn(
    today,
    [
      { metricKey: "hip", points: [p("2026-09-01", 60, "left", "v1"), p(today, 85, "left", "v2")] },
      { metricKey: "drop", points: [p("2026-08-01", 0.5), p("2026-09-01", 1.5)] },
      { metricKey: "hip", points: [p(today, 80)] },
      { metricKey: "drop", points: [p("2026-09-01", 0.7), p(today, 0.7)] },
      { metricKey: "none", points: [p("2026-09-01", 1), p(today, 9)] },
    ],
    bands,
  );
  assert.deepEqual(shifts, []);
}

console.log("screening-shift: over eenheden heen op de eigen schaal, niet over een protocolwissel, alleen de laatste screening");
