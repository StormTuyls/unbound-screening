import { scaleOf, type Band } from "@/lib/screening/bands";
import { zoneFill } from "@/components/report/BandStrip";

/**
 * De banden van een regel op schaal, met de namen en de drempels eronder.
 *
 * Dezelfde schaal en dezelfde tinten als BandStrip in het rapport. Het verschil
 * is de tekst: daar draagt de strip alleen de plaats van een meting en blijven
 * de getallen weg, omdat ze op A4 op 6pt zouden uitkomen. Hier zijn de
 * drempels precies waar je voor komt.
 */

const W = 420;
const BAR = 22;

export function BandScale({
  bands,
  decimals,
  label,
  className,
}: {
  bands: Band[];
  decimals: number;
  /** Wat een schermlezer hoort in plaats van de tekening. */
  label: string;
  className?: string;
}) {
  if (bands.length === 0) return null;

  const [lo, hi] = scaleOf(bands);
  const x = (v: number) => ((v - lo) / (hi - lo)) * W;
  const maxScore = Math.max(0, ...bands.map((b) => b.score ?? 0));
  // Elke eindige grens één keer, ook bij een regel met gaten waar lt en de
  // volgende gte verschillen.
  const edges = [
    ...new Set(bands.flatMap((b) => [b.gte, b.lt].filter((n): n is number => n !== undefined))),
  ];

  return (
    <svg viewBox={`0 0 ${W} 54`} role="img" aria-label={label} className={className}>
      {bands.map((band, i) => {
        const from = x(band.gte ?? lo);
        const to = x(band.lt ?? hi);
        return (
          <g key={`${band.status}-${i}`}>
            <rect
              x={from}
              y={0}
              width={Math.max(0, to - from)}
              height={BAR}
              fill={zoneFill(band.score ?? null, maxScore)}
            />
            <text
              x={(from + to) / 2}
              y={BAR + 13}
              textAnchor="middle"
              fontSize={11}
              className="fill-ink"
            >
              {band.status.replace(/_/g, " ")}
            </text>
          </g>
        );
      })}
      {edges.map((edge) => (
        <g key={edge}>
          <line x1={x(edge)} x2={x(edge)} y1={0} y2={BAR} className="stroke-ink-muted" strokeWidth={0.8} />
          <text
            x={x(edge)}
            y={BAR + 28}
            textAnchor="middle"
            fontSize={11}
            className="fill-ink-muted tabular-nums"
          >
            {edge.toFixed(decimals)}
          </text>
        </g>
      ))}
      <rect x={0.4} y={0.4} width={W - 0.8} height={BAR - 0.8} fill="none" className="stroke-hairline" strokeWidth={0.8} />
    </svg>
  );
}
