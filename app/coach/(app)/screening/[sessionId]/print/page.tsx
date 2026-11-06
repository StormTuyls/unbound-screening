import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { ensureFrozenScreening, getScreeningReport } from "@/lib/report/screeningFreeze";
import type { SnapshotNote, SnapshotResult } from "@/lib/report/screeningSnapshot";
import { AutoPrint } from "@/components/review/AutoPrint";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { logAudit } from "@/lib/audit";

export async function generateMetadata() {
  const t = await getTranslations("screening");
  return { title: t("report"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

const UNIT_SUFFIX: Record<string, string> = {
  deg: "°", cm: " cm", n: " N", xbw: "×BW", score: "", percent: "%",
  hand_lengths: "", mm: " mm", s: " s", kg: " kg",
};

/**
 * De voet van een onderdeel.
 *
 * Telt ONDERDELEN en geen bladen, en dat is geen slordigheid. Een blok als
 * "Mobiliteit onderste lidmaat" heeft 49 regels en loopt dus over meer dan één
 * A4. Een voet die "3 / 9" zegt staat op het tweede vel van dat blok te
 * liegen, en een rapport dat over zijn eigen paginering liegt is erger dan een
 * rapport zonder paginering. Een echt bladnummer zou counter(pages) in een
 * @page-marge vragen, en dat ondersteunt Chrome niet.
 */
function ReportFoot({ label }: { label: string }) {
  return <p className="report-foot">{label}</p>;
}

/**
 * Het screeningrapport om af te drukken of als PDF te bewaren.
 *
 * Rendert UITSLUITEND uit een bevroren versie, nooit uit de huidige stand. Dat
 * is bij een screening scherper dan bij een intake: de praktijk kan op
 * /coach/library een drempel bijstellen, en zonder deze regel zou een afdruk
 * van vorig jaar met de drempels van vandaag opnieuw ingedeeld worden.
 *
 * HOEVEEL PAGINA'S ER ZIJN, BEPAALT DE INHOUD.
 *
 * Het ontwerp tekende er vijf, met een vaste pagina per onderwerp. Dat houdt
 * geen stand: er is een artboard "reactieve kracht" terwijl de bibliotheek
 * geen enkele sprong- of RSI-test kent, en een lege pagina in een klinisch
 * rapport roept een vraag op die niemand kan beantwoorden. Dus: een kaft, dan
 * een blad per blok dat deze sessie gemeten is, dan de leeswijzer. Komen er
 * sprongtests bij, dan komt dat blad er vanzelf bij.
 *
 * Daarom staat het paginanummer ook in de opmaak en niet in de print-CSS.
 * Chrome ondersteunt @page-marges met counter(pages) niet, en we weten hier
 * precies hoeveel bladen er zijn.
 */
export default async function ScreeningPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { sessionId } = await params;
  const { version } = await searchParams;
  if (!isUuid(sessionId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/coach/login?next=/coach/screening/${sessionId}/print`);
  }
  if (access.kind !== "coach") notFound();

  const actor = { id: access.coach.id };
  const report = version
    ? await getScreeningReport(sessionId, Number(version))
    : await ensureFrozenScreening(sessionId, actor, access.coach.id);
  if (!report) notFound();

  const t = await getTranslations("screening");
  const tn = await getTranslations("notes");
  const locale = await getLocale();
  const s = report.snapshot;
  const name = (r: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? r.testLabelNl : r.testLabelEn;
  const noteLabel = (n: SnapshotNote) =>
    (locale === "nl" ? n.metricLabelNl : n.metricLabelEn) ?? n.metricKey;

  await logAudit({
    actorId: access.coach.id,
    actorKind: access.coach.role === "admin" ? "admin" : "coach",
    action: "export",
    entitySchema: "medical",
    entityTable: "screening_reports",
    entityId: sessionId,
    detail: { version: report.version, format: "print" },
  });

  const blocks = new Map<string, SnapshotResult[]>();
  for (const row of s.results) {
    const list = blocks.get(row.block) ?? [];
    list.push(row);
    blocks.set(row.block, list);
  }
  const ordered = [...blocks].sort(
    (a, b) => (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
  );

  const rules = new Map<string, { label: string; version: number | null; citation: string | null; note: string | null }>();
  for (const row of s.results) {
    if (row.ruleCitation || row.ruleNote) {
      rules.set(name(row), {
        label: name(row),
        version: row.ruleVersion,
        citation: row.ruleCitation,
        note: row.ruleNote,
      });
    }
  }

  // De kaftcijfers staan in de data, niet hier: cover_rank op de metriek. Zie
  // de migratie 20261106090100. Alleen gemeten waarden, want een kaft met
  // "niet gemeten" vat niets samen.
  const cover = s.results
    .filter((r) => r.coverRank != null && r.kind === "absolute" && r.status === "computed")
    .sort((a, b) => (a.coverRank! - b.coverRank!) || a.side.localeCompare(b.side));

  // Een snapshot van versie 2 of ouder heeft deze niet. Dan blijft de kaft
  // leeg op dat punt, en dat is juist: die oordelen bestonden toen niet.
  const observations = s.observations ?? [];
  const byKind = (kind: "strength" | "development") =>
    observations
      .filter((n) => n.kind === kind)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const strengths = byKind("strength");
  const developments = byKind("development");

  const parts = ["summary", ...ordered.map(([block]) => block), "legend"];
  const foot = (part: string) => (
    <ReportFoot
      label={t("partOf", { n: parts.indexOf(part) + 1, total: parts.length })}
    />
  );

  return (
    <>
      <AutoPrint />
      <div className="report">
        {/* Alleen op papier zichtbaar, en daar op elk vel: een los blad uit een
            medisch rapport moet te herleiden zijn tot wie en wanneer. Op het
            scherm staat dat al in de kop van de kaft. */}
        <p className="report-running" aria-hidden>
          {PRACTICE_NAME} · {s.athleteName ?? t("title")} · {s.occurredOn}
          {` · ${t("reportVersion", { n: report.version, date: s.generatedAt.slice(0, 10) })}`}
        </p>
        <section className="report-page">
          <header className="mb-6">
            <p className="text-xs text-ink-muted">{PRACTICE_NAME}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {s.athleteName ?? t("title")}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {t("title")} {s.occurredOn}
              {s.bodyMassKg ? ` · ${s.bodyMassKg} kg` : ""}
              {s.testerName ? ` · ${t("tester")}: ${s.testerName}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint">
              {t("reportVersion", { n: report.version, date: s.generatedAt.slice(0, 10) })}
            </p>
          </header>

          {cover.length > 0 && (
            <section className="mb-6 break-inside-avoid">
              <h2 className="mb-1 text-sm font-medium">{t("coverFigures")}</h2>
              <table className="w-full text-sm">
                <tbody>
                  {cover.map((row, i) => (
                    <tr key={`${row.metricKey}-${row.side}-${i}`} className="border-t border-hairline">
                      <td className="py-1">
                        {name(row)}
                        <span className="ml-1.5 text-xs text-ink-faint">
                          {row.side === "left" ? t("left") : row.side === "right" ? t("right") : ""}
                        </span>
                      </td>
                      <td className="py-1 text-right text-base tabular-nums">
                        {row.value!.toFixed(row.decimals)}
                        {UNIT_SUFFIX[row.unit] ?? ` ${row.unit}`}
                      </td>
                      <td className="w-24 py-1 pl-3 text-right text-xs text-ink-muted">
                        {row.bandStatus?.replace(/_/g, " ") ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {s.notes && (
            <section className="mb-6 break-inside-avoid">
              <h2 className="mb-1 text-sm font-medium">{t("decision")}</h2>
              <p className="text-sm">{s.notes}</p>
            </section>
          )}

          {[
            { key: "strength" as const, heading: tn("strengths"), rows: strengths },
            { key: "development" as const, heading: tn("developments"), rows: developments },
          ].map(({ key, heading, rows }) =>
            rows.length === 0 ? null : (
              <section key={key} className="mb-6 break-inside-avoid">
                <h2 className="mb-1 text-sm font-medium">{heading}</h2>
                <ol className="text-sm">
                  {rows.map((note, i) => (
                    <li key={note.id} className="flex gap-3 border-t border-hairline py-1.5">
                      <span className="w-4 shrink-0 tabular-nums text-ink-muted">
                        {note.rank ?? i + 1}
                      </span>
                      <span className="min-w-0">
                        {note.body}
                        {note.metricKey && (
                          <span className="ml-1.5 text-xs text-ink-faint">{noteLabel(note)}</span>
                        )}
                        {note.target && (
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            {tn("target")}: {note.target}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ),
          )}

          {foot("summary")}
        </section>

        {ordered.map(([block, rows]) => (
          <section key={block} className="report-page">
            <h2 className="mb-1 text-sm font-medium">
              {t(`blocks.${block}` as "blocks.core")}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.metricKey}-${row.kind}-${row.side}-${i}`} className="border-t border-hairline">
                    <td className="py-1">
                      {name(row)}
                      <span className="ml-1.5 text-xs text-ink-faint">
                        {(() => {
                          const side =
                            row.side === "left"
                              ? t("left")
                              : row.side === "right"
                                ? t("right")
                                : "";
                          if (row.kind === "asymmetry") return t("asymmetry");
                          // Ook bij een delta de zijde erbij: anders staan er
                          // twee regels "t.o.v. vorige" die niet te scheiden zijn.
                          if (row.kind === "delta") {
                            return side ? `${t("vsPrevious")}, ${side}` : t("vsPrevious");
                          }
                          return side;
                        })()}
                      </span>
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {row.status === "computed" && row.value !== null
                        ? `${row.value.toFixed(row.kind === "absolute" ? row.decimals : 1)}${UNIT_SUFFIX[row.unit] ?? ` ${row.unit}`}`
                        : t(`unavailable.${row.unavailableReason ?? "missing_input"}` as "unavailable.missing_input")}
                    </td>
                    <td className="w-24 py-1 pl-3 text-right text-xs text-ink-muted">
                      {row.bandStatus?.replace(/_/g, " ") ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* De losse vlaggen bij dit blok, zodat een opmerking naast zijn
                meting staat en niet drie bladen verderop. Sterktes en
                ontwikkelpunten staan al op de kaft. */}
            {observations.filter((n) => n.kind === null && n.metricKey && rows.some((r) => r.metricKey === n.metricKey)).map((note) => (
              <p key={note.id} className="mt-2 text-xs text-ink-muted">
                {noteLabel(note)}: {note.body}
                {note.action && ` → ${note.action}`}
              </p>
            ))}

            {foot(block)}
          </section>
        ))}

        <section className="report-page">
          <h2 className="mb-1 text-sm font-medium">{t("legend")}</h2>

          {s.unclassified > 0 && (
            <p className="mb-4 text-xs text-ink-faint">
              {t("unclassified", { count: s.unclassified })}
            </p>
          )}

          {rules.size > 0 && (
            <section className="mb-4 break-inside-avoid">
              <h3 className="mb-1 text-sm font-medium">{t("rules")}</h3>
              <ul className="text-xs text-ink-faint">
                {[...rules.values()].map((rule) => (
                  <li key={rule.label} className="py-0.5">
                    <span className="text-ink-muted">{rule.label}</span>
                    {rule.version !== null && ` · ${t("ruleVersion", { n: rule.version })}`}
                    {rule.citation && ` · ${rule.citation}`}
                    {rule.note && <span className="block">{rule.note}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="border-t border-hairline pt-2 text-[10px] text-ink-faint">
            {t("frozenNote")}
          </p>

          {foot("legend")}
        </section>
      </div>
    </>
  );
}
