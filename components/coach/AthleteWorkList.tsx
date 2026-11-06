"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AthleteWorkRow } from "@/lib/db/athletes";
import { ageOn } from "@/lib/screening/population";
import { daysBetween, isOverdue } from "@/lib/screening/overdue";

/**
 * De werklijst van de praktijk.
 *
 * Zelfde vorm als AthleteList in athlete-intake (zoekveld, een filterknop, de
 * gefilterde lijst eronder) en met opzet dezelfde klassen, zodat de twee
 * schermen niet uit elkaar lopen. De inhoud verschilt wel: daar tellen intakes
 * en wachtenden, hier de laatste meting en de open vlaggen.
 *
 * Een tabel en geen lijst, want dit IS tabellarisch: vier kolommen die je over
 * de regels heen vergelijkt. De tabel scrolt horizontaal op een smal scherm in
 * plaats van zijn kolommen te laten stapelen, want een stapel die je kolom voor
 * kolom moet teruglezen is geen vergelijking meer.
 *
 * Twee kolommen uit het ontwerp ontbreken, en dat is geen vergetelheid: de club
 * heeft geen kolom op athletes, en de actieve klacht met NPRS woont aan de
 * intakekant. Zie lib/db/athletes.ts.
 */

export function AthleteWorkList({
  athletes,
  today,
}: {
  athletes: AthleteWorkRow[];
  /** Uit de server, zodat de lijst en de tegels dezelfde dag tellen. */
  today: string;
}) {
  const t = useTranslations("athletes");
  const tf = useTranslations("format");
  const [search, setSearch] = useState("");
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return athletes.filter((athlete) => {
      if (onlyFlagged && athlete.openFlags === 0) return false;
      if (needle === "") return true;
      return (athlete.name ?? "").toLowerCase().includes(needle);
    });
  }, [athletes, search, onlyFlagged]);

  const flaggedTotal = athletes.reduce((sum, a) => sum + a.openFlags, 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          type="search"
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-hairline bg-surface px-3 text-sm outline-none focus-visible:border-brand-500"
        />
        <button
          type="button"
          onClick={() => setOnlyFlagged((current) => !current)}
          aria-pressed={onlyFlagged}
          className={
            onlyFlagged
              ? "min-h-11 shrink-0 rounded-md bg-ink px-3.5 text-xs font-medium text-surface"
              : "min-h-11 shrink-0 rounded-md px-3.5 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
          }
        >
          {t("openFlags")}
          {flaggedTotal > 0 && ` (${flaggedTotal})`}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {athletes.length === 0 ? t("none") : t("noMatch")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-label text-ink-muted uppercase">
                <th scope="col" className="py-2 pr-4 font-normal">{t("colAthlete")}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t("colLast")}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{t("colFlags")}</th>
                <th scope="col" className="py-2 text-right font-normal">
                  <span className="sr-only">{t("colAction")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((athlete) => {
                const days = athlete.lastScreening
                  ? daysBetween(athlete.lastScreening, today)
                  : null;
                const overdue = isOverdue(athlete.lastScreening, today);
                const age = ageOn(athlete.dateOfBirth, today);
                const sport = [athlete.sport, athlete.discipline]
                  .filter((part): part is string => part !== null)
                  .join(", ");
                const meta = [age === null ? null : t("years", { n: age }), sport || null]
                  .filter((part): part is string => part !== null)
                  .join(" · ");

                return (
                  <tr key={athlete.id} className="border-b border-rule">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/coach/athletes/${athlete.id}/screening`}
                        className="flex min-h-11 flex-col justify-center"
                      >
                        <span className="font-medium underline-offset-2 hover:underline">
                          {athlete.name ?? t("nameUnknown")}
                        </span>
                        {meta && <span className="text-xs text-ink-muted">{meta}</span>}
                      </Link>
                    </td>

                    <td className="py-2 pr-4 tabular-nums">
                      {athlete.lastScreening === null ? (
                        <span className="text-warn">{t("never")}</span>
                      ) : (
                        <>
                          <span className={overdue ? "text-warn" : undefined}>
                            {athlete.lastScreening}
                          </span>
                          <span
                            className={`block text-xs ${overdue ? "text-warn" : "text-ink-muted"}`}
                          >
                            {/* "0 dagen" leest als een storing. De sleutel
                                bestond al en werd nergens gebruikt. */}
                            {days === 0 ? tf("today") : t("daysAgo", { count: days as number })}
                          </span>
                        </>
                      )}
                    </td>

                    <td className="py-2 pr-4">
                      {/* Kleur is niet het enige signaal: er staat een aantal bij. */}
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`inline-block h-[7px] w-[7px] rounded-full ${
                            athlete.openFlags > 0 ? "bg-warn" : "bg-hairline"
                          }`}
                        />
                        <span className={athlete.openFlags > 0 ? "text-ink-muted" : "text-ink-faint"}>
                          {athlete.openFlags > 0
                            ? t("flagsOpen", { count: athlete.openFlags })
                            : t("noFlags")}
                        </span>
                      </span>
                    </td>

                    <td className="py-2 text-right whitespace-nowrap">
                      {/* Beide handelingen, en niet alleen de meest waarschijnlijke
                          zoals het ontwerp doet. Anders is er voor een atleet die
                          net gemeten is geen weg naar een nieuwe meting. */}
                      {athlete.lastSessionId && (
                        <Link
                          href={`/coach/screening/${athlete.lastSessionId}`}
                          className="mr-2 inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                        >
                          {t("report")}
                        </Link>
                      )}
                      <Link
                        href={`/coach/athletes/${athlete.id}/screening/new`}
                        className={`inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-inset transition-colors ${
                          overdue
                            ? "bg-brand-700 text-surface ring-brand-700 hover:bg-brand-800"
                            : "ring-hairline hover:bg-canvas"
                        }`}
                      >
                        {t("enter")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
