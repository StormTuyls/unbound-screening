import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { ensureFrozenScreening, getScreeningReport } from "@/lib/report/screeningFreeze";
import type { SnapshotBand, SnapshotNote, SnapshotResult } from "@/lib/report/screeningSnapshot";
import { BandStrip, type StripMarker } from "@/components/report/BandStrip";
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
 * De drempels van een regel als tekst.
 *
 * Hier staan de getallen die bewust NIET in de strip staan. De strip toont de
 * plaats, de leeswijzer de schaal, en samen zijn ze na te rekenen. Halfopen
 * intervallen, zoals het schema ze overal hanteert: de ondergrens telt mee en
 * de bovengrens niet.
 */
function bandRanges(bands: SnapshotBand[]): string {
  return bands
    .map((b) => {
      const name = b.status.replace(/_/g, " ");
      if (b.gte !== undefined && b.lt !== undefined) return `${name} ${b.gte}\u2013${b.lt}`;
      if (b.gte !== undefined) return `${name} \u2265 ${b.gte}`;
      return `${name} < ${b.lt}`;
    })
    .join(" \u00b7 ");
}

/**
 * De kleur van een kerncijfer op de kaft.
 *
 * Nooit het enige signaal: het bandwoord staat er altijd onder, en op een
 * afdruk zonder achtergrondkleuren blijft dat woord staan. Alleen de onderste
 * band krijgt inkt; de rest is gewoon zwart, anders kleurt de halve kaft.
 *
 * Alleen score 0, en niet ook 1, om dezelfde reden als bandStyle() op het
 * sessiescherm: score 1 is op een regel met twee banden de beste uitkomst en
 * op een regel met vier de op een na slechtste.
 */
function figureInk(score: number | null): string {
  return score !== null && score <= 0 ? "text-danger" : "";
}

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
   * Eén regel per metriek in plaats van een rij per uitkomst.
   *
   * Links, rechts, de asymmetrie en twee keer "t.o.v. vorige" waren vijf losse
   * rijen over dezelfde test. Dat leest als een opsomming en niet als een
   * bevinding. Hier worden ze één blok: de zijden onder elkaar, het verschil
   * eronder, en de vorige waarde als annotatie waar hij hoort.
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

  // De kaftcijfers staan in de data, niet hier: cover_rank op de metriek. Zie
  // de migratie 20261106090100. Alleen gemeten waarden, want een kaft met
  // "niet gemeten" vat niets samen.
  // Eén kaart per test en niet per zijde. Links en rechts van dezelfde test
  // horen op dezelfde schaal naast elkaar: twee losse kaarten dwingen de lezer
  // om twee getallen te onthouden en zelf te vergelijken, en dat is precies de
  // vergelijking waar een screening om draait.
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

          {/* Kaarten en geen tabelregels. Een kaft hoort in één oogopslag te
              lezen, en dat doet een rij van vijf cijfers wel en een tabel van
              vijf regels niet. Drie kolommen, want dat klopt zowel op A4 (794px
              breed) als op een telefoon. */}
          {cover.length > 0 && (
            <section className="mb-6 break-inside-avoid">
              <h2 className="mb-2 text-label text-ink-muted uppercase">{t("coverFigures")}</h2>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {cover.map((g) => (
                  <div
                    key={g.metricKey}
                    className="break-inside-avoid rounded-card border border-hairline bg-surface px-3.5 py-3"
                  >
                    <p className="text-label text-ink-muted uppercase">{g.name}</p>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
                      {g.sides
                        .filter((r) => r.status === "computed" && r.value !== null)
                        .map((r) => (
                          <p
                            key={r.side}
                            className={`text-xl font-semibold tracking-tight tabular-nums ${figureInk(r.bandScore)}`}
                          >
                            {sideMark(r.side) && (
                              <span className="mr-1 text-xs font-normal text-ink-muted">
                                {sideMark(r.side)}
                              </span>
                            )}
                            {r.value!.toFixed(r.decimals)}
                            {UNIT_SUFFIX[r.unit] ?? ` ${r.unit}`}
                          </p>
                        ))}
                    </div>
                    {g.bands && (
                      <BandStrip bands={g.bands} markers={g.markers} className="mt-2 h-5 w-full" />
                    )}
                    <p className="mt-1.5 text-xs text-ink-muted">
                      {g.sides
                        .map((r) => r.bandStatus?.replace(/_/g, " "))
                        .filter(Boolean)
                        .join(" · ") || t("noBand")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Het besluit is het enige op de kaft dat de behandelaar zelf
              schreef, en het draagt de hele afdruk. Een getint vlak zet het
              apart van de cijfers eromheen. Print zonder achtergronden laat de
              rand en het label staan, dus het blijft leesbaar als een blok. */}
          {s.notes && (
            <section className="mb-6 flex gap-3.5 break-inside-avoid rounded-card border border-brand-100 bg-brand-50 px-4 py-3.5">
              <h2 className="shrink-0 pt-0.5 text-label text-brand-700 uppercase">
                {t("decision")}
              </h2>
              <p className="text-sm leading-relaxed">{s.notes}</p>
            </section>
          )}

          {[
            { key: "strength" as const, heading: tn("strengths"), rows: strengths },
            { key: "development" as const, heading: tn("developments"), rows: developments },
          ].map(({ key, heading, rows }) =>
            rows.length === 0 ? null : (
              <section key={key} className="mb-6 break-inside-avoid">
                <h2
                  className={`mb-1 text-label uppercase ${key === "strength" ? "text-brand-700" : "text-warn"}`}
                >
                  {heading}
                </h2>
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
            <ul>
              {groupByMetric(rows).map((g) => (
                <li
                  key={g.metricKey}
                  className="flex items-start gap-4 border-t border-hairline py-2 break-inside-avoid"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{g.name}</p>
                    {g.sides.map((row) => (
                      <p
                        key={`${row.side}`}
                        className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs"
                      >
                        {sideWord(row.side) && (
                          <span className="w-10 shrink-0 text-ink-muted">{sideWord(row.side)}</span>
                        )}
                        <span className="tabular-nums">
                          {row.status === "computed" && row.value !== null
                            ? `${row.value.toFixed(row.decimals)}${UNIT_SUFFIX[row.unit] ?? ` ${row.unit}`}`
                            : t(`unavailable.${row.unavailableReason ?? "missing_input"}` as "unavailable.missing_input")}
                        </span>
                        {row.bandStatus && (
                          <span className="text-ink-muted">{row.bandStatus.replace(/_/g, " ")}</span>
                        )}
                        {typeof prevOf(g, row.side) === "number" && (
                          <span className="text-ink-muted tabular-nums">
                            {t("was", { value: prevOf(g, row.side)!.toFixed(row.decimals) })}
                          </span>
                        )}
                      </p>
                    ))}
                    {g.asymmetry?.status === "computed" && g.asymmetry.value !== null && (
                      <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
                        {t("asymmetry")} {g.asymmetry.value.toFixed(1)}%
                        {asymDirection(g.asymmetry) && ` \u00b7 ${t(asymDirection(g.asymmetry)!)}`}
                      </p>
                    )}
                  </div>

                  {/* Vaste breedte, ook als er geen strip is: anders springt
                      de tekstkolom per test van breedte en leest de lijst als
                      een trap. */}
                  <div className="w-[190px] shrink-0">
                    {g.bands && (
                      <BandStrip bands={g.bands} markers={g.markers} className="h-6 w-full" />
                    )}
                  </div>
                </li>
              ))}
            </ul>

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

          {/* De sleutel bij de strips. Een figuur zonder legende in een
              medisch rapport dwingt de lezer te raden wat een open stip
              betekent, en dat is precies wat een leeswijzer moet voorkomen. */}
          {s.results.some((r) => r.bands) && (
            <p className="mb-4 max-w-prose text-xs text-ink-muted">{t("figureKey")}</p>
          )}

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
                    {/* De getallen achter de strips. Zonder deze regel toont
                        het rapport wel waar een waarde staat, maar niet
                        waartussen. */}
                    {rule.bands && (
                      <span className="block text-ink-muted tabular-nums">
                        {bandRanges(rule.bands)}
                      </span>
                    )}
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
