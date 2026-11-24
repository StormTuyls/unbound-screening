import { notFound, redirect } from "next/navigation";
import { Archivo, Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { ensureFrozenScreening, getScreeningReport } from "@/lib/report/screeningFreeze";
import type { SnapshotBand, SnapshotNote, SnapshotResult } from "@/lib/report/screeningSnapshot";
import { BandStrip, type StripMarker } from "@/components/report/BandStrip";
import { SideBars } from "@/components/report/SideBars";
import { AutoPrint } from "@/components/review/AutoPrint";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { logAudit } from "@/lib/audit";
import { unitSuffix } from "@/lib/screening/units";
import { bandText } from "@/lib/screening/bands";

/**
 * De sneden van het rapport, los van die van de app. Zie .report in
 * globals.css voor waarom deze en waarom alleen hier.
 */
const reportDisplay = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--ff-report-display" });
// next/font kent voor Atkinson geen fallbackmaten; zonder deze vlag waarschuwt
// hij bij elke build. De afdruk wacht toch op de webfonts (AutoPrint).
const reportSans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--ff-report-sans", adjustFontFallback: false });
const reportMono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--ff-report-mono", adjustFontFallback: false });

export async function generateMetadata() {
  const t = await getTranslations("screening");
  return { title: t("report"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

/** Links goud, rechts groen: de reekskleuren die .report zet. */
const SIDE_COLOR: Record<string, string> = {
  left: "var(--color-series-1)",
  right: "var(--color-series-2)",
};

/** Het kleine uppercase label in de smalle snede, overal hetzelfde. */
const EYEBROW = "font-display text-[11px] font-semibold tracking-[0.16em] uppercase";

/**
 * De kop van een blad.
 *
 * Overgenomen uit de performancerapporten van de praktijk: een bovenregel die
 * zegt van wie dit blad is, de titel in de smalle snede, een ondertitel, en
 * rechts de behandelaar achter een gouden lijn. Daaronder een gouden regel.
 *
 * Staat op elk onderdeel en niet alleen op de kaft, want de bladen raken los.
 */
function PageHead({
  eyebrow,
  title,
  subtitle,
  tester,
  role,
  large = false,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  tester?: string | null;
  role: string;
  large?: boolean;
}) {
  const Title = large ? "h1" : "h2";
  return (
    <header className="mb-5 flex items-end justify-between gap-6 border-b-[1.5px] border-brand-600 pb-3">
      <div className="min-w-0">
        <p className={`${EYEBROW} text-ink-muted`}>{eyebrow}</p>
        <Title
          className={`mt-0.5 leading-[1.02] font-bold text-[var(--report-forest)] uppercase ${
            large ? "text-[38px]" : "text-[30px]"
          }`}
        >
          {title}
        </Title>
        {subtitle && <p className="mt-1 text-[12.5px] text-ink-muted">{subtitle}</p>}
      </div>
      {tester && (
        <div className="shrink-0 border-r-[3px] border-brand-600 pr-3 text-right">
          <p className="font-display text-lg font-bold text-[var(--report-forest)]">{tester}</p>
          <p className={`${EYEBROW} mt-0.5 text-brand-700`}>{role}</p>
        </div>
      )}
    </header>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2.5 text-[15px] font-bold tracking-[0.1em] text-brand-700 uppercase">
      {children}
    </h2>
  );
}

/**
 * De kleur van een meetwaarde.
 *
 * Nooit het enige signaal: het bandwoord staat er altijd onder. Alleen de
 * onderste band krijgt inkt, want score 1 is op een regel met twee banden de
 * beste uitkomst en op een regel met vier de op een na slechtste.
 */
function figureInk(score: number | null): string {
  return score !== null && score <= 0 ? "text-danger" : "";
}

/**
 * De kleur op de asymmetrie: groen onder 5 %, amber tot 10 %, rood daarboven.
 *
 * Dit is de conventie uit de performancerapporten van de kine, op haar vraag
 * overgenomen, en alleen op papier. Het blijft een leesconventie en geen
 * klinische drempel: er volgt geen band, geen vlag en geen alarm uit, en de
 * leeswijzer zegt letterlijk welke grenzen het zijn. Het scherm kleurt de
 * asymmetrie nog steeds niet.
 */
function asymInk(value: number): string {
  return value < 5 ? "text-ok" : value <= 10 ? "text-warn" : "text-danger";
}

/**
 * Het screeningrapport om af te drukken of als PDF te bewaren.
 *
 * Rendert UITSLUITEND uit een bevroren versie, nooit uit de huidige stand. De
 * praktijk kan op /praktijk/library een drempel bijstellen, en zonder deze
 * regel zou een afdruk van vorig jaar met de drempels van vandaag opnieuw
 * ingedeeld worden.
 *
 * Drie onderdelen, elk op een nieuw vel: de samenvatting, de resultaten en de
 * leeswijzer. De blokken lopen in de resultaten door in plaats van elk een eigen
 * vel te krijgen; een vel met één test erop is papier en geen informatie. Hoeveel
 * vellen de resultaten nemen, bepaalt de inhoud. Het bladnummer staat in een
 * @page-margevak, zie globals.css.
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
    redirect(`/praktijk/login?next=/praktijk/screening/${sessionId}/print`);
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

  const rules = new Map<string, { label: string; version: number | null; citation: string | null; note: string | null; bands: SnapshotBand[] | null }>();
  for (const row of s.results) {
    if (row.ruleCitation || row.ruleNote) {
      const seen = rules.get(name(row));
      rules.set(name(row), {
        label: name(row),
        version: row.ruleVersion,
        citation: row.ruleCitation,
        note: row.ruleNote,
        // De banden hangen aan de absolute rij; een asymmetrierij heeft er
        // geen. Eerst gevonden wint, zodat een latere lege rij ze niet wist.
        bands: seen?.bands ?? row.bands ?? null,
      });
    }
  }

  // Meestal komen alle regels uit dezelfde bron. Dan staat die één keer onder
  // de tabel en niet op elke rij.
  const sourceLine = (r: { version: number | null; citation: string | null }) =>
    [r.version !== null ? t("ruleVersion", { n: r.version }) : null, r.citation]
      .filter(Boolean)
      .join(" · ");
  const sharedSource =
    new Set([...rules.values()].map(sourceLine)).size === 1 ? [...rules.values()][0] : null;

  const sideWord = (side: string) =>
    side === "left" ? t("left") : side === "right" ? t("right") : "";

  /** De eerste letter van de zijde, voor de baan in de strip. */
  const sideMark = (side: string) =>
    side === "left" || side === "right" ? sideWord(side).slice(0, 1).toUpperCase() : "";

  interface Grouped {
    metricKey: string;
    name: string;
    sides: SnapshotResult[];
    asymmetry: SnapshotResult | null;
    previous: Map<string, number>;
    bands: SnapshotBand[] | null;
    markers: StripMarker[];
  }

  const SIDE_ORDER = ["left", "right", "bilateral"];

  /**
   * Eén regel per metriek in plaats van een rij per uitkomst: de zijden naast
   * elkaar, het verschil erbij, en de vorige waarde als annotatie.
   */
  function groupByMetric(rows: SnapshotResult[]): Grouped[] {
    const groups = new Map<string, Grouped>();
    for (const row of rows) {
      const g = groups.get(row.metricKey) ?? {
        metricKey: row.metricKey,
        name: name(row),
        sides: [],
        asymmetry: null,
        previous: new Map<string, number>(),
        bands: null,
        markers: [],
      };
      if (row.kind === "asymmetry") {
        g.asymmetry = row;
      } else if (row.kind === "delta") {
        if (typeof row.inputs?.previous === "number") {
          g.previous.set(row.side, row.inputs.previous);
        }
      } else {
        g.sides.push(row);
        g.bands = g.bands ?? row.bands ?? null;
      }
      groups.set(row.metricKey, g);
    }
    for (const g of groups.values()) {
      g.sides.sort((a, b) => SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side));
      g.markers = g.sides
        .filter((r) => r.status === "computed" && r.value !== null)
        .map((r) => ({
          value: r.value as number,
          label: sideMark(r.side),
          previous: g.previous.get(r.side) ?? null,
          color: SIDE_COLOR[r.side],
        }));
    }
    return [...groups.values()];
  }

  const prevOf = (g: Grouped, side: string) => g.previous.get(side) ?? null;

  /** Welke kant lager ligt, uit de teller en de noemer van de asymmetrie. */
  const asymDirection = (row: SnapshotResult) => {
    const l = row.inputs?.left;
    const r = row.inputs?.right;
    if (typeof l !== "number" || typeof r !== "number" || l === r) return null;
    return l < r ? ("lowerLeft" as const) : ("lowerRight" as const);
  };

  // De kaftcijfers staan in de data: cover_rank op de metriek (migratie
  // 20261106090100). Eén tegel per test, met links en rechts naast elkaar.
  const cover = groupByMetric(
    s.results.filter(
      (r) => r.coverRank != null && (r.kind === "absolute" || r.kind === "delta"),
    ),
  )
    .filter((g) => g.sides.some((r) => r.status === "computed"))
    .sort((a, b) => (a.sides[0].coverRank ?? 99) - (b.sides[0].coverRank ?? 99));

  // Een snapshot van versie 2 of ouder heeft deze niet. Dan blijft de kaft
  // leeg op dat punt, en dat is juist: die oordelen bestonden toen niet.
  const observations = s.observations ?? [];
  const byKind = (kind: "strength" | "development") =>
    observations
      .filter((n) => n.kind === kind)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const strengths = byKind("strength");
  const developments = byKind("development");
  // De prioriteiten zijn de ontwikkelpunten waar een richting of werkdoel bij
  // staat. Het ontwikkelpunt zegt wat er is, de prioriteit wat eraan gebeurt.
  const priorities = developments.filter((n) => n.action || n.target);
  const flags = observations.filter((n) => n.kind === null);

  const valueText = (row: SnapshotResult) =>
    row.status === "computed" && row.value !== null
      ? `${row.value.toFixed(row.decimals)}${unitSuffix(row.unit)}`
      : t(`unavailable.${row.unavailableReason ?? "missing_input"}` as "unavailable.missing_input");

  const headCell = "pb-1.5 font-display text-[11px] font-semibold tracking-[0.1em] text-[var(--report-forest)] uppercase";

  return (
    <>
      <AutoPrint />
      <div className={`report ${reportDisplay.variable} ${reportSans.variable} ${reportMono.variable} text-[12.5px] leading-[1.45]`}>
        {/* Alleen op papier zichtbaar, en daar op elk vel: een los blad uit een
            medisch rapport moet te herleiden zijn tot wie en wanneer. */}
        <p className="report-running" aria-hidden>
          {PRACTICE_NAME} · {s.athleteName ?? t("title")} · {s.occurredOn}
          {` · ${t("reportVersion", { n: report.version, date: s.generatedAt.slice(0, 10) })}`}
        </p>

        {/* ── Samenvatting ───────────────────────────────────────────────── */}
        <section className="report-page">
          <PageHead
            large
            eyebrow={`${PRACTICE_NAME} · ${s.occurredOn}`}
            title={s.athleteName ?? t("title")}
            subtitle={[t("title"), s.bodyMassKg ? `${s.bodyMassKg} kg` : null, t("reportVersion", { n: report.version, date: s.generatedAt.slice(0, 10) })]
              .filter(Boolean)
              .join(" · ")}
            tester={s.testerName}
            role={t("tester")}
          />

          {cover.length > 0 && (
            <section aria-label={t("coverFigures")} className="mb-4 grid gap-2.5 break-inside-avoid [grid-template-columns:repeat(auto-fit,minmax(118px,1fr))]">
              {cover.map((g) => (
                <div key={g.metricKey} className="border border-hairline bg-canvas px-3 py-2.5 print:[print-color-adjust:exact]">
                  <p className={`${EYEBROW} tracking-[0.1em] text-ink-muted`}>{g.name}</p>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
                    {g.sides
                      .filter((r) => r.status === "computed" && r.value !== null)
                      .map((r) => (
                        <p key={r.side} className={`font-mono text-[22px] leading-none tabular-nums ${figureInk(r.bandScore)}`}>
                          {sideMark(r.side) && (
                            <span className="mr-1 text-[11px] text-ink-muted">{sideMark(r.side)}</span>
                          )}
                          {r.value!.toFixed(r.decimals)}
                          <span className="text-[12px]">{unitSuffix(r.unit)}</span>
                        </p>
                      ))}
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-ink-muted">
                    {g.sides
                      .map((r) => r.bandStatus?.replace(/_/g, " "))
                      .filter(Boolean)
                      .join(" · ") || t("noBand")}
                  </p>
                </div>
              ))}
            </section>
          )}

          {(strengths.length > 0 || developments.length > 0) && (
            <div className="mb-4 grid grid-cols-2 gap-3.5">
              {[
                { key: "strength", heading: tn("strengths"), rows: strengths, line: "border-t-[var(--color-series-2)]", ink: "text-ok" },
                { key: "development", heading: tn("developments"), rows: developments, line: "border-t-brand-600", ink: "text-brand-700" },
              ].map(({ key, heading, rows, line, ink }) => (
                <section key={key} className={`break-inside-avoid border border-t-[3px] border-hairline bg-canvas px-4 pt-3 pb-1.5 print:[print-color-adjust:exact] ${line}`}>
                  <h2 className={`${EYEBROW} mb-2 ${ink}`}>{heading}</h2>
                  <ul className="list-disc pl-3.5 marker:text-ink-muted">
                    {rows.map((note) => (
                      <li key={note.id} className="mb-1.5">
                        {note.metricKey && <b>{noteLabel(note)}. </b>}
                        {note.body}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {/* Het besluit draagt de hele afdruk. Een donkergroen vlak, zoals in
              de rapporten van de praktijk; print-color-adjust houdt het vlak
              ook als de printer achtergronden weglaat. */}
          {s.notes && (
            <section className="mb-5 flex items-baseline gap-3.5 bg-[var(--report-forest)] px-[18px] py-3 break-inside-avoid print:[print-color-adjust:exact]">
              <h2 className={`${EYEBROW} shrink-0 text-brand-200`}>{t("decision")}</h2>
              <p className="text-[14px] leading-[1.45] font-semibold text-[#f6f3ea]">{s.notes}</p>
            </section>
          )}

          {priorities.length > 0 && (
            <section className="break-inside-avoid">
              <SectionTitle>{t("priorities")}</SectionTitle>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-[1.5px] border-[var(--report-forest)] text-left">
                    <th className={`${headCell} w-6`}>#</th>
                    <th className={`${headCell} w-36 pr-2`}>{t("priority")}</th>
                    <th className={`${headCell} pr-2`}>{t("direction")}</th>
                    <th className={`${headCell} w-52`}>{t("targetNext")}</th>
                  </tr>
                </thead>
                <tbody>
                  {priorities.map((note, i) => (
                    <tr key={note.id} className="border-b border-rule align-top">
                      <td className="py-1.5 font-mono">{note.rank ?? i + 1}</td>
                      <td className="py-1.5 pr-2 font-semibold">{note.metricKey ? noteLabel(note) : note.body}</td>
                      <td className="py-1.5 pr-2">{note.action ?? (note.metricKey ? note.body : "–")}</td>
                      <td className="py-1.5">{note.target ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </section>

        {/* ── Resultaten ─────────────────────────────────────────────────── */}
        <section className="report-page">
          <PageHead
            eyebrow={`${PRACTICE_NAME} · ${s.athleteName ?? ""}`}
            title={t("results")}
            subtitle={s.occurredOn}
            tester={s.testerName}
            role={t("tester")}
          />

          <p aria-hidden className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-muted print:[print-color-adjust:exact]">
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--color-series-1)]" />{t("left")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--color-series-2)]" />{t("right")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border-[1.5px] border-ink-muted" />{t("legendPrevious")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 bg-[var(--color-danger-band)]" />{t("legendLowest")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 bg-[var(--color-warn-band)]" />{t("legendMiddle")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 border border-hairline" />{t("legendLevel")}</span>
          </p>

          {/* Een tabel en geen lijst: alle linkerwaarden van een blok staan onder
              elkaar, en zo zie je een patroon per zijde en niet alleen per test.
              Chrome herhaalt de thead op elk vel. */}
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-[1.5px] border-[var(--report-forest)] text-left">
                <th className={headCell}>{t("test")}</th>
                <th className={`${headCell} w-[104px] pl-2 text-right`}>{t("left")}</th>
                <th className={`${headCell} w-[104px] pl-2 text-right`}>{t("right")}</th>
                <th className={`${headCell} w-[84px] pl-2 text-right`}>{t("asymmetry")}</th>
                <th className="w-[200px] pb-1.5" />
              </tr>
            </thead>
            {ordered.map(([block, rows]) => (
              <tbody key={block}>
                <tr className="break-after-avoid">
                  <th
                    colSpan={5}
                    scope="colgroup"
                    className={`${EYEBROW} bg-canvas px-1.5 py-1 text-left text-[10.5px] text-brand-700 print:[print-color-adjust:exact]`}
                  >
                    {t(`blocks.${block}` as "blocks.core")}
                  </th>
                </tr>
                {groupByMetric(rows).map((g) => {
                  const cell = (side: string) => {
                    const row = g.sides.find((r) => r.side === side);
                    if (!row) return null;
                    const prev = prevOf(g, side);
                    return (
                      <>
                        <span className={`block font-mono text-[12px] tabular-nums ${figureInk(row.bandScore)}`}>
                          {valueText(row)}
                        </span>
                        {(row.bandStatus || typeof prev === "number") && (
                          <span className="block text-[10.5px] leading-tight whitespace-nowrap text-ink-muted">
                            {[
                              row.bandStatus?.replace(/_/g, " "),
                              typeof prev === "number" ? t("was", { value: prev.toFixed(row.decimals) }) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </>
                    );
                  };
                  const bilateral = g.sides.length === 1 && g.sides[0].side === "bilateral";
                  const dir = g.asymmetry ? asymDirection(g.asymmetry) : null;
                  const asym = g.asymmetry?.status === "computed" ? g.asymmetry.value : null;
                  const paired = g.markers.length === 2 && !g.bands;
                  return (
                    <tr key={g.metricKey} className="border-b border-rule break-inside-avoid">
                      <td className="py-1.5 pr-3 align-middle">{g.name}</td>
                      {bilateral ? (
                        <td className="py-1.5 pl-2 text-right align-middle" colSpan={2}>{cell("bilateral")}</td>
                      ) : (
                        <>
                          <td className="py-1.5 pl-2 text-right align-middle">{cell("left")}</td>
                          <td className="py-1.5 pl-2 text-right align-middle">{cell("right")}</td>
                        </>
                      )}
                      <td className={`py-1.5 pl-2 text-right align-middle font-mono text-[11.5px] whitespace-nowrap tabular-nums ${asym !== null ? asymInk(asym) : ""}`}>
                        {asym !== null ? (
                          <>
                            {asym.toFixed(1)}&#8201;%
                            {dir && <span className="ml-1">{sideMark(dir === "lowerLeft" ? "left" : "right")}</span>}
                          </>
                        ) : (
                          <span className="text-ink-muted">&#8211;</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-3 align-middle print:[print-color-adjust:exact]">
                        {g.bands ? (
                          <BandStrip bands={g.bands} markers={g.markers} className="w-full" />
                        ) : paired ? (
                          <SideBars
                            className="w-full"
                            bars={g.markers.map((m) => ({
                              label: m.label,
                              value: m.value,
                              previous: m.previous,
                              color: m.color ?? "var(--color-ink)",
                            }))}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>

          {/* De losse vlaggen, met de test erbij waar ze over gaan. Sterktes en
              ontwikkelpunten staan al op de samenvatting. */}
          {flags.length > 0 && (
            <section className="mt-5 break-inside-avoid">
              <SectionTitle>{tn("heading")}</SectionTitle>
              <ul className="flex flex-col gap-2">
                {flags.map((note) => (
                  <li key={note.id} className="border-l-[3px] border-brand-600 bg-canvas px-3.5 py-2 print:[print-color-adjust:exact]">
                    <p className={`${EYEBROW} ${note.severity === "action" ? "text-danger" : "text-brand-700"}`}>
                      {tn(note.severity as "info")} · {note.metricKey ? noteLabel(note) : tn("wholeSession")}
                    </p>
                    <p className="mt-0.5 text-[13px]">
                      {note.body}
                      {note.action && <b>{` → ${note.action}`}</b>}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        {/* ── Leeswijzer ─────────────────────────────────────────────────── */}
        <section className="report-page">
          <PageHead
            eyebrow={`${PRACTICE_NAME} · ${s.athleteName ?? ""}`}
            title={t("legend")}
            subtitle={s.occurredOn}
            tester={s.testerName}
            role={t("tester")}
          />

          <table className="mb-6 w-full border-collapse">
            <tbody>
              {[
                { label: t("guideStrips"), text: t("figureKey") },
                { label: t("guideBars"), text: t("barsKey") },
                { label: t("guideAsym"), text: t("asymKey") },
                ...(s.unclassified > 0
                  ? [{ label: t("guideUnrated"), text: t("unclassified", { count: s.unclassified }) }]
                  : []),
                { label: t("guideFrozen"), text: t("frozenNote") },
              ].map(({ label, text }) => (
                <tr key={label} className="border-b border-rule align-top break-inside-avoid">
                  <th scope="row" className="w-32 py-1.5 pr-3 text-left font-semibold">{label}</th>
                  <td className="py-1.5">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rules.size > 0 && (
            <section className="mt-6">
              <SectionTitle>{t("rules")}</SectionTitle>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-[1.5px] border-[var(--report-forest)] text-left">
                    <th className={`${headCell} w-40 pr-3`}>{t("test")}</th>
                    <th className={`${headCell} pr-3`}>{t("ruleBands")}</th>
                    <th className={`${headCell} w-[45%]`}>{t("ruleExplain")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rules.values()].map((rule) => (
                    <tr key={rule.label} className="border-b border-rule align-top break-inside-avoid">
                      <td className="py-1.5 pr-3">
                        {rule.label}
                        {!sharedSource && (
                          <span className="block text-[10.5px] text-ink-muted">{sourceLine(rule)}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-[11.5px] tabular-nums">
                        {rule.bands ? bandText(rule.bands) : "–"}
                      </td>
                      <td className="py-1.5 text-[11px] text-ink-muted">{rule.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sharedSource && (
                <p className="mt-1.5 text-[11px] text-ink-muted">{sourceLine(sharedSource)}</p>
              )}
            </section>
          )}
        </section>
      </div>
    </>
  );
}
