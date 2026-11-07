"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BandStrip } from "@/components/report/BandStrip";
import {
  asymDirection,
  groupByMetric,
  ratioOf,
  type Grouped,
  type ResultRow,
} from "@/lib/screening/group";
import { unitSuffix } from "@/lib/screening/units";

export type { ResultRow };

/**
 * De uitslagen van een screening, zoals de afdruk ze al toont.
 *
 * Het scherm liep hier achter op het rapport. Elke uitkomst was een eigen
 * regel: links, rechts, de asymmetrie en twee keer "t.o.v. vorige". Bij
 * zesentwintig tests zijn dat ruim negentig regels van gelijk gewicht, zonder
 * een enkele band in beeld, en dan is bladeren het enige wat er te doen valt.
 *
 * Hier staat dezelfde tabel als op papier: een regel per test, links en rechts
 * als kolommen die je verticaal kunt aflezen, de asymmetrie ernaast, en de
 * strip die laat zien waar de meting op haar eigen schaal ligt. De vorige
 * waarde is een annotatie bij de meting en geen eigen regel.
 *
 * Een clientcomponent om één reden, dezelfde als bij AthleteWorkList: het
 * filter. De pagina zelf blijft een servercomponent.
 */

export function ScreeningResults({
  results,
  blockOrder,
}: {
  results: ResultRow[];
  /** De volgorde waarin een behandelaar een screening afwerkt. */
  blockOrder: readonly string[];
}) {
  const t = useTranslations("screening");
  const [onlyAttention, setOnlyAttention] = useState(false);

  const groups = useMemo(() => groupByMetric(results), [results]);

  const blocks = useMemo(() => {
    const shown = onlyAttention
      ? groups.filter((group) => group.attention !== null)
      : groups;
    const byBlock = new Map<string, Grouped[]>();
    for (const group of shown) {
      const list = byBlock.get(group.block) ?? [];
      list.push(group);
      byBlock.set(group.block, list);
    }
    return [...byBlock].sort(
      (a, b) =>
        (blockOrder.indexOf(a[0]) + 1 || 99) - (blockOrder.indexOf(b[0]) + 1 || 99),
    );
  }, [groups, onlyAttention, blockOrder]);

  const attentionCount = groups.filter((g) => g.attention !== null).length;

  // De kerncijfers stonden alleen op de afdruk. De praktijk stelt zelf in
  // welke tests hier horen; zie cover_rank op de metriek.
  const cover = groups
    .filter((group) => group.coverRank !== null)
    .filter((group) => group.sides.some((row) => row.status === "computed"))
    .sort((a, b) => (a.coverRank ?? 99) - (b.coverRank ?? 99));

  const sideWord = (side: string) =>
    side === "left" ? t("left") : side === "right" ? t("right") : "";

  const sideMark = (side: string) =>
    side === "left" || side === "right"
      ? sideWord(side).slice(0, 1).toUpperCase()
      : "";

  const valueText = (row: ResultRow) =>
    row.status === "computed" && row.value !== null
      ? `${row.value.toFixed(row.decimals)}${unitSuffix(row.unit)}`
      : null;

  /**
   * Wat er onder een waarde staat.
   *
   * De band, de vorige meting, en bij een genormaliseerde waarde ook waar hij
   * vandaan komt. Dat laatste is geen opsmuk: zonder de newton en de massa
   * erbij is 2,41 xBW niet na te rekenen, en hij verschuift stil mee met het
   * gewicht van de atleet. Spec §11.
   */
  const subText = (row: ResultRow, previous: number | undefined) =>
    [
      row.bandStatus?.replace(/_/g, " ") ?? null,
      typeof previous === "number"
        ? t("was", { value: previous.toFixed(row.decimals) })
        : null,
      row.kind === "normalised" && row.inputs
        ? `${row.inputs.source ?? "-"} N · ${row.inputs.bodyMassKg ?? "-"} kg`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  function Cell({ group, side }: { group: Grouped; side: string }) {
    const row = group.sides.find((candidate) => candidate.side === side);
    if (!row) return null;
    const value = valueText(row);
    const sub = subText(row, group.previous.get(side));
    const ratio = ratioOf(row);
    return (
      <>
        <span
          className={`text-sm tabular-nums ${ratio !== null && ratio <= 0 ? "text-danger" : ""}`}
        >
          {value ?? (
            <span className="text-xs text-ink-muted">
              {t(
                `unavailable.${row.unavailableReason ?? "missing_input"}` as
                  "unavailable.missing_input",
              )}
            </span>
          )}
        </span>
        {sub && <span className="mt-0.5 block text-xs text-ink-muted">{sub}</span>}
      </>
    );
  }

  return (
    <>
      {cover.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-label text-ink-muted uppercase">{t("coverFigures")}</h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {cover.map((group) => (
              <div
                key={group.metricKey}
                className="rounded-card border border-hairline bg-canvas px-3.5 py-3"
              >
                <p className="text-label text-ink-muted uppercase">{group.label}</p>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
                  {group.sides
                    .filter((row) => row.status === "computed" && row.value !== null)
                    .map((row) => {
                      const ratio = ratioOf(row);
                      return (
                        <p
                          key={row.side}
                          className={`text-xl font-semibold tracking-tight tabular-nums ${
                            ratio !== null && ratio <= 0 ? "text-danger" : ""
                          }`}
                        >
                          {sideMark(row.side) && (
                            <span className="mr-1 text-xs font-normal text-ink-muted">
                              {sideMark(row.side)}
                            </span>
                          )}
                          {row.value!.toFixed(row.decimals)}
                          {unitSuffix(row.unit)}
                        </p>
                      );
                    })}
                </div>
                {group.bands && (
                  <BandStrip
                    bands={group.bands}
                    markers={group.markers}
                    className="mt-2 w-full"
                  />
                )}
                <p className="mt-1.5 text-xs text-ink-muted">
                  {group.sides
                    .map((row) => row.bandStatus?.replace(/_/g, " "))
                    .filter(Boolean)
                    .join(" · ") || t("noBand")}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Het filter verbergt niets wat je niet terugkrijgt met één tik, en
          staat standaard uit: een dossier hoort te openen op wat erin staat.
          Wat aandacht vraagt is ook zonder filter te vinden, aan de streep
          links langs de regel. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOnlyAttention((current) => !current)}
          aria-pressed={onlyAttention}
          disabled={attentionCount === 0}
          className={
            onlyAttention
              ? "min-h-11 shrink-0 rounded-md bg-ink px-3.5 text-xs font-medium text-surface"
              : "min-h-11 shrink-0 rounded-md px-3.5 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas disabled:opacity-50"
          }
        >
          {t("needsAttention")}
          {attentionCount > 0 && ` (${attentionCount})`}
        </button>
        <p className="text-xs text-ink-muted">
          {t("shownOf", {
            shown: blocks.reduce((sum, [, list]) => sum + list.length, 0),
            total: groups.length,
          })}
        </p>
      </div>

      {blocks.map(([block, list]) => (
        <section key={block} className="mb-8">
          <h2 className="border-b border-hairline pb-2 text-sm font-semibold">
            {t(`blocks.${block}` as "blocks.core")}
          </h2>

          {/* Scrolt op een smal scherm in plaats van zijn kolommen te stapelen:
              een stapel die je kolom voor kolom moet teruglezen is geen
              vergelijking meer. Zelfde keuze als in de werklijst. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse">
              <thead>
                <tr className="border-b border-hairline text-left text-label text-ink-muted uppercase">
                  <th scope="col" className="py-2 pr-3 font-normal">{t("test")}</th>
                  <th scope="col" className="w-28 py-2 pl-3 text-right font-normal">
                    {t("left")}
                  </th>
                  <th scope="col" className="w-28 py-2 pl-3 text-right font-normal">
                    {t("right")}
                  </th>
                  <th scope="col" className="w-24 py-2 pl-3 text-right font-normal">
                    {t("asymmetry")}
                  </th>
                  <th scope="col" className="w-[13rem] py-2 pl-3 font-normal">
                    {t("onScale")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((group) => {
                  const bilateral =
                    group.sides.length === 1 && group.sides[0].side !== "left" &&
                    group.sides[0].side !== "right";
                  const direction = group.asymmetry ? asymDirection(group.asymmetry) : null;
                  return (
                    <tr key={group.metricKey} className="border-b border-rule">
                      {/* Een streep en geen gekleurde rij: een rij in kleur
                          verft de getallen mee, en dan draagt de kleur de
                          waarde in plaats van de band. */}
                      <td
                        className={`border-l-[3px] py-2 pr-3 pl-3 align-top text-sm ${
                          group.attention === "danger"
                            ? "border-danger"
                            : group.attention === "warn"
                              ? "border-warn"
                              : "border-transparent"
                        }`}
                      >
                        {group.label}
                      </td>

                      {bilateral ? (
                        <td className="py-2 pl-3 text-right align-top" colSpan={2}>
                          <Cell group={group} side={group.sides[0].side} />
                        </td>
                      ) : (
                        <>
                          <td className="py-2 pl-3 text-right align-top">
                            <Cell group={group} side="left" />
                          </td>
                          <td className="py-2 pl-3 text-right align-top">
                            <Cell group={group} side="right" />
                          </td>
                        </>
                      )}

                      {/* Geen kleur op de asymmetrie. Wanneer een verschil te
                          groot is, is een klinische drempel, en die hoort in
                          reference_rules en niet in een renderer. */}
                      <td className="py-2 pl-3 text-right align-top text-sm tabular-nums">
                        {group.asymmetry?.status === "computed" &&
                        group.asymmetry.value !== null ? (
                          <>
                            {group.asymmetry.value.toFixed(1)}&#8201;%
                            {direction && (
                              <span className="ml-1 text-xs text-ink-muted">
                                {sideMark(direction)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-muted">&#8211;</span>
                        )}
                      </td>

                      <td className="py-2 pl-3 align-middle">
                        {group.bands ? (
                          <BandStrip
                            bands={group.bands}
                            markers={group.markers}
                            className="w-full"
                          />
                        ) : (
                          <span className="text-xs text-ink-muted">{t("noBand")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* De sleutel bij de strips. Dezelfde zin als in de leeswijzer van de
          afdruk: een figuur zonder legende laat de lezer raden wat een open
          stip betekent. */}
      {groups.some((group) => group.bands) && (
        <p className="mb-6 max-w-prose text-xs text-ink-muted">{t("figureKey")}</p>
      )}
    </>
  );
}
