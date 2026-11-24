/**
 * Links en rechts als staven, voor een test zonder band.
 *
 * Zonder referentieregel is er geen schaal om een stip op te zetten, maar de
 * vraag "verschillen de zijden, en sinds vorige keer" blijft. Staven vanaf nul
 * op een gedeelde schaal beantwoorden die, met de vorige meting als streepje.
 * Zelfde afmetingen als BandStrip, zodat ze in dezelfde kolom passen.
 *
 * Alleen voor waarden vanaf nul: een staaf naar een negatieve hoek zegt niets
 * meer. Dan tekent deze component niets en staan de getallen er alleen.
 */

const W = 200;
const H = 24;
const GUTTER = 14;

export interface SideBar {
  label: string;
  value: number;
  previous?: number | null;
  color: string;
}

export function SideBars({ bars, className }: { bars: SideBar[]; className?: string }) {
  const values = bars.flatMap((b) => (typeof b.previous === "number" ? [b.value, b.previous] : [b.value]));
  if (bars.length === 0 || values.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const max = Math.max(...values) * 1.15 || 1;
  const x = (v: number) => GUTTER + (v / max) * (W - GUTTER - 2);
  const lane = (H - 4) / bars.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={bars
        .map((b) => `${b.label}: ${b.value}` + (typeof b.previous === "number" ? ` (${b.previous})` : ""))
        .join(", ")}
    >
      <line x1={GUTTER} x2={GUTTER} y1={0} y2={H} stroke="var(--color-ink-muted)" strokeWidth={0.6} />
      {bars.map((b, i) => {
        const y = 2 + i * lane;
        return (
          <g key={b.label || i}>
            {b.label && (
              <text x={0} y={y + lane / 2 + 3} fontSize={9} fill="var(--color-ink-muted)">
                {b.label}
              </text>
            )}
            <rect x={GUTTER} y={y + 1} width={x(b.value) - GUTTER} height={lane - 3} fill={b.color} />
            {typeof b.previous === "number" && (
              <line
                x1={x(b.previous)}
                x2={x(b.previous)}
                y1={y - 0.5}
                y2={y + lane - 0.5}
                stroke="var(--color-ink)"
                strokeWidth={1.2}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
