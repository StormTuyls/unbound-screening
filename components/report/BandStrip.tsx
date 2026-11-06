import type { SnapshotBand } from "@/lib/report/screeningSnapshot";

/**
 * Waar een meting staat op de schaal van haar eigen referentieregel.
 *
 * Eén figuur dat drie vragen tegelijk beantwoordt, want ze worden ook samen
 * gesteld: haalt deze atleet de norm, verschillen links en rechts, en welke
 * kant gaat het op sinds de vorige test. Los getekend zouden dat drie
 * grafiekjes per test zijn, en bij vijfentwintig tests is dat geen rapport
 * meer maar een poster.
 *
 *   - De gekleurde zones zijn de banden van de regel, op schaal.
 *   - Elke zijde krijgt een eigen baan, zodat links en rechts onder elkaar op
 *     dezelfde schaal staan en het verschil een horizontale afstand is.
 *   - De open cirkel is de vorige meting, met een lijn naar de huidige. De
 *     richting van die lijn IS het verloop.
 *
 * Geen getallen in de tekening. Op A4 zou een asbijschrift op ongeveer 6pt
 * uitkomen en dat leest niemand; de waarden staan als gewone tekst naast de
 * strip en de drempels staan voluit in de leeswijzer. De strip draagt dus
 * alleen de plaats, nooit de enige informatie. Dat is ook de reden dat de
 * zones in lichtheid verschillen en niet alleen in kleurtoon: op een
 * zwart-witafdruk en met kleurenblindheid blijft de volgorde zichtbaar.
 */

const W = 200;
const H = 24;
/** Ruimte links voor de L/R-letters, buiten de schaal. */
const GUTTER = 11;

export interface StripMarker {
  value: number;
  /** "L", "R", of leeg bij een tweebenige test. */
  label: string;
  previous?: number | null;
}

/**
 * De kleur van een band, naar zijn plek op de schaal van DEZE regel.
 *
 * Niet naar de score zelf. Een score van 1 is bij navicular_drop (twee banden)
 * de beste uitkomst en bij een krachtregel (vier banden) de op een na
 * slechtste. Door te delen door de hoogste score in dezelfde lijst klopt het
 * voor beide. Dit is de fout die eerder op het sessiescherm stond.
 */
function zoneFill(score: number | null, max: number): string {
  if (score === null || max <= 0) return "var(--color-canvas)";
  const ratio = score / max;
  if (ratio <= 0) return "var(--color-danger-soft)";
  if (ratio >= 0.66) return "var(--color-ok-soft)";
  return "var(--color-warn-soft)";
}

/**
 * Het bereik dat de tekening beslaat.
 *
 * De eindbanden zijn open ("alles onder 75", "alles vanaf 85") en hebben dus
 * geen rand om op te tekenen. Die krijgen een marge van een kwart van het
 * eindige bereik, zodat ze zichtbaar doorlopen zonder een grens te suggereren
 * die er niet is. Een waarde buiten alle banden rekt het bereik op in plaats
 * van tegen de rand geplakt te worden: een meting die er ver naast zit hoort er
 * ver naast te staan.
 */
function domainOf(bands: SnapshotBand[], values: number[]): [number, number] {
  const edges = bands.flatMap((b) => [b.gte, b.lt].filter((n): n is number => n !== undefined));
  if (edges.length === 0) return [0, 1];
  let lo = Math.min(...edges);
  let hi = Math.max(...edges);
  const pad = (hi - lo || Math.abs(lo) || 1) * 0.25;
  lo -= pad;
  hi += pad;
  for (const v of values) {
    if (v < lo) lo = v - pad * 0.5;
    if (v > hi) hi = v + pad * 0.5;
  }
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1];
}

export function BandStrip({
  bands,
  markers,
  className,
}: {
  bands: SnapshotBand[];
  markers: StripMarker[];
  className?: string;
}) {
  const shown = markers.filter((m) => Number.isFinite(m.value));
  if (bands.length === 0 || shown.length === 0) return null;

  const values = shown.flatMap((m) =>
    typeof m.previous === "number" ? [m.value, m.previous] : [m.value],
  );
  const [lo, hi] = domainOf(bands, values);
  const x = (v: number) => GUTTER + ((v - lo) / (hi - lo)) * (W - GUTTER - 2);
  const maxScore = Math.max(0, ...bands.map((b) => b.score ?? 0));

  // Eén baan per zijde, verticaal gecentreerd in wat er over is.
  const lanes = shown.length;
  const laneY = (i: number) => (H / (lanes + 1)) * (i + 1);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={shown
        .map(
          (m) =>
            `${m.label ? `${m.label}: ` : ""}${m.value}` +
            (typeof m.previous === "number" ? ` (${m.previous})` : ""),
        )
        .join(", ")}
      preserveAspectRatio="none"
    >
      {bands.map((b, i) => {
        const from = x(b.gte ?? lo);
        const to = x(b.lt ?? hi);
        return (
          <rect
            key={`${b.status}-${i}`}
            x={from}
            y={0}
            width={Math.max(0, to - from)}
            height={H}
            fill={zoneFill(b.score, maxScore)}
          />
        );
      })}

      {/**
       * De grenzen in inkt, niet als witte naad tussen twee vlakken.
       *
       * Een browser print achtergrondkleuren alleen als de gebruiker dat
       * aanzet, en dat staat standaard uit. Met witte naden valt dan de hele
       * tekening weg en blijven er twee zwarte staafjes over die nergens meer
       * op staan. Met de grenzen en de omlijsting in inkt blijft er altijd een
       * schaal met drempelstrepen over, ook zonder een enkel gekleurd vlak.
       */}
      {bands.slice(1).map((b, i) =>
        b.gte === undefined ? null : (
          <line
            key={`edge-${i}`}
            x1={x(b.gte)}
            x2={x(b.gte)}
            y1={0}
            y2={H}
            stroke="var(--color-ink-muted)"
            strokeWidth={0.6}
          />
        ),
      )}
      <rect
        x={GUTTER}
        y={0.3}
        width={W - GUTTER - 2}
        height={H - 0.6}
        fill="none"
        stroke="var(--color-hairline)"
        strokeWidth={0.6}
      />

      {shown.map((m, i) => {
        const y = laneY(i);
        const cx = x(m.value);
        const hasPrev = typeof m.previous === "number" && m.previous !== m.value;
        const px = hasPrev ? x(m.previous as number) : cx;
        return (
          <g key={`${m.label}-${i}`}>
            {m.label && (
              <text
                x={0}
                y={y + 3}
                fontSize={8}
                fill="var(--color-ink-muted)"
                className="tabular-nums"
              >
                {m.label}
              </text>
            )}
            {hasPrev && (
              <>
                <line
                  x1={px}
                  x2={cx}
                  y1={y}
                  y2={y}
                  stroke="var(--color-ink-muted)"
                  strokeWidth={0.8}
                />
                <line
                  x1={px}
                  x2={px}
                  y1={y - 3.5}
                  y2={y + 3.5}
                  stroke="var(--color-ink-muted)"
                  strokeWidth={1.2}
                />
              </>
            )}
            {/* Staafjes en geen stippen. De strip rekt met zijn kolom mee
                (preserveAspectRatio="none"), en een cirkel wordt dan een
                zichtbaar platte ellips terwijl een rechthoek alleen iets
                smaller wordt. */}
            <rect
              x={cx - 1.3}
              y={y - 4.5}
              width={2.6}
              height={9}
              rx={1}
              fill="var(--color-ink)"
            />
          </g>
        );
      })}
    </svg>
  );
}
