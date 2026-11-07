"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AthleteWorkRow } from "@/lib/db/athletes";
import { ageOn } from "@/lib/screening/population";
import { OVERDUE_DAYS, daysBetween, isOverdue } from "@/lib/screening/overdue";

/**
 * De werklijst van de praktijk.
 *
 * Eén lijst voor allebei de helften van het werk. De intake en de screening
 * hadden er elk een, met dezelfde namen en andere kolommen, in twee apps. Dat
 * zijn geen twee lijsten maar één die in tweeën ligt: een behandelaar heeft
 * 's ochtends één vraag, namelijk wie er vandaag iets van hem nodig heeft, en
 * die vraag gaat niet over welke app het antwoord toevallig bewaart.
 *
 * De intakekolom komt uit public.intakes in de intake-app, over dezelfde
 * databank. Alleen de status en de datum: wat er IN een intake staat is
 * medische inhoud en hoort niet op een overzichtspagina die openstaat terwijl
 * er iemand naast je zit.
 *
 * De tegels waren tellers en zijn nu filters. Hetzelfde cijfer, maar de vraag
 * die je erbij stelt ("wie zijn die vier dan?") is een tik geworden in plaats
 * van zelf zoeken.
 *
 * Een tabel en geen lijst, want dit IS tabellarisch: kolommen die je over de
 * regels heen vergelijkt. Hij scrolt horizontaal op een smal scherm in plaats
 * van zijn kolommen te laten stapelen; een stapel die je kolom voor kolom moet
 * teruglezen is geen vergelijking meer.
 */

type Filter = "all" | "review" | "overdue" | "flags";

/** Een intake die ingediend is en nog op een behandelaar wacht. */
function waitsForReview(athlete: AthleteWorkRow): boolean {
  return athlete.intakeStatus === "submitted" || athlete.intakeStatus === "in_review";
}

export function AthleteWorkList({
  athletes,
  today,
  intakeUrl,
}: {
  athletes: AthleteWorkRow[];
  /** Uit de server, zodat de tegels en de regels dezelfde dag tellen. */
  today: string;
  /**
   * Het adres van de intake-app, of null. Nakijken gebeurt daar: deze app
   * toont dat er iets ligt, de andere laat het goedkeuren. Zonder adres geen
   * knop, want een link naar nergens is erger dan geen link.
   */
  intakeUrl: string | null;
}) {
  const t = useTranslations("athletes");
  const tf = useTranslations("format");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const tests: Record<Filter, (athlete: AthleteWorkRow) => boolean> = useMemo(
    () => ({
      all: () => true,
      review: waitsForReview,
      overdue: (athlete) => isOverdue(athlete.lastScreening, today),
      flags: (athlete) => athlete.openFlags > 0,
    }),
    [today],
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return athletes.filter((athlete) => {
      if (!tests[filter](athlete)) return false;
      if (needle === "") return true;
      return (athlete.name ?? "").toLowerCase().includes(needle);
    });
  }, [athletes, search, filter, tests]);

  const flagged = athletes.filter((a) => a.openFlags > 0);
  const tiles = [
    {
      id: "all" as const,
      label: t("allFiles"),
      value: athletes.length,
      note: t("allFilesNote"),
      alert: false,
    },
    {
      id: "review" as const,
      label: t("awaitingReview"),
      value: athletes.filter(waitsForReview).length,
      note: t("awaitingReviewNote"),
      alert: false,
    },
    {
      id: "overdue" as const,
      label: t("overdue", { days: OVERDUE_DAYS }),
      value: athletes.filter((a) => isOverdue(a.lastScreening, today)).length,
      note: t("overdueNote"),
      alert: true,
    },
    {
      id: "flags" as const,
      label: t("openFlags"),
      value: flagged.reduce((sum, a) => sum + a.openFlags, 0),
      note: t("openFlagsNote", { count: flagged.length }),
      alert: true,
    },
  ];

  return (
    <>
      {/* De tegel is de knop. Een gekleurde rand links en niet een gevulde
          tegel: gevuld zou het cijfer meeverven, en dat cijfer is de inhoud. */}
      <div className="mb-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const on = tile.id === filter;
          return (
            <button
              key={tile.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(tile.id)}
              className={`rounded-card border border-l-[3px] px-3.5 py-3 text-left transition-colors ${
                on
                  ? "border-hairline bg-canvas"
                  : "border-hairline bg-surface hover:bg-canvas"
              } ${on ? (tile.alert ? "border-l-warn" : "border-l-brand-600") : "border-l-hairline"}`}
            >
              <span className="block text-label text-ink-muted uppercase">{tile.label}</span>
              <span
                className={`mt-1.5 block text-2xl font-medium tabular-nums ${
                  tile.alert && tile.value > 0 ? "text-warn" : ""
                }`}
              >
                {tile.value}
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">{tile.note}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          type="search"
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-hairline bg-surface px-3 text-sm outline-none focus-visible:border-brand-500"
        />
        <p className="text-xs text-ink-muted">
          {t("shownOf", { shown: shown.length, total: athletes.length })}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {athletes.length === 0 ? t("none") : t("noMatch")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-label text-ink-muted uppercase">
                <th scope="col" className="py-2 pr-4 font-normal">{t("colAthlete")}</th>
                <th scope="col" className="w-44 py-2 pr-4 font-normal">{t("colIntake")}</th>
                <th scope="col" className="w-40 py-2 pr-4 font-normal">{t("colLast")}</th>
                <th scope="col" className="w-28 py-2 pr-4 font-normal">{t("colFlags")}</th>
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
                const waiting = waitsForReview(athlete);
                const age = ageOn(athlete.dateOfBirth, today);
                const sport = [athlete.sport, athlete.discipline]
                  .filter((part): part is string => part !== null)
                  .join(", ");
                const meta = [age === null ? null : t("years", { n: age }), sport || null]
                  .filter((part): part is string => part !== null)
                  .join(" · ");

                return (
                  <tr key={athlete.id} className="border-b border-rule">
                    {/* Een streep links waar iets ligt. Nakijken gaat voor:
                        een intake die wacht blokkeert de behandelaar, een
                        achterstallige meting wacht al langer en kan nog even. */}
                    <td
                      className={`border-l-[3px] py-2 pr-4 pl-3 ${
                        waiting
                          ? "border-brand-600"
                          : overdue || athlete.openFlags > 0
                            ? "border-warn"
                            : "border-transparent"
                      }`}
                    >
                      <Link
                        href={`/praktijk/athletes/${athlete.id}/screening`}
                        className="flex min-h-11 flex-col justify-center"
                      >
                        <span className="font-medium underline-offset-2 hover:underline">
                          {athlete.name ?? t("nameUnknown")}
                        </span>
                        {meta && <span className="text-xs text-ink-muted">{meta}</span>}
                      </Link>
                    </td>

                    <td className="py-2 pr-4">
                      {athlete.intakeStatus === null ? (
                        <span className="text-ink-muted">{t("intakeStatus.none")}</span>
                      ) : (
                        <>
                          <span className={waiting ? "text-brand-700" : undefined}>
                            {t(
                              `intakeStatus.${athlete.intakeStatus}` as
                                "intakeStatus.approved",
                            )}
                          </span>
                          {athlete.intakeAt && (
                            <span className="block text-xs text-ink-muted tabular-nums">
                              {athlete.intakeAt}
                            </span>
                          )}
                        </>
                      )}
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
                            {/* "0 dagen" leest als een storing. */}
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
                        <span className="text-ink-muted">
                          {athlete.openFlags > 0
                            ? t("flagsOpen", { count: athlete.openFlags })
                            : t("noFlags")}
                        </span>
                      </span>
                    </td>

                    <td className="py-2 text-right whitespace-nowrap">
                      {/* Nakijken woont in de intake-app. Deze lijst zegt dat
                          er iets ligt en brengt je erheen; goedkeuren gebeurt
                          daar, want daar staat de inhoud. */}
                      {waiting && intakeUrl && athlete.lastIntakeId && (
                        <a
                          href={`${intakeUrl}/review/${athlete.lastIntakeId}`}
                          className="mr-2 inline-flex min-h-11 items-center rounded-md bg-brand-700 px-3.5 text-xs text-surface ring-1 ring-brand-700 ring-inset transition-colors hover:bg-brand-800"
                        >
                          {t("reviewIntake")}
                        </a>
                      )}
                      {athlete.lastSessionId && (
                        <Link
                          href={`/praktijk/screening/${athlete.lastSessionId}`}
                          className="mr-2 inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                        >
                          {t("report")}
                        </Link>
                      )}
                      <Link
                        href={`/praktijk/athletes/${athlete.id}/screening/new`}
                        className={`inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-inset transition-colors ${
                          overdue && !waiting
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
