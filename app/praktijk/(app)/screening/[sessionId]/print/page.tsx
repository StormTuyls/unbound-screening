import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { ensureFrozenScreening, getScreeningReport } from "@/lib/report/screeningFreeze";
import type { SnapshotBand, SnapshotNote, SnapshotResult } from "@/lib/report/screeningSnapshot";
import { BandStrip, type StripMarker } from "@/components/report/BandStrip";
import { AutoPrint } from "@/components/review/AutoPrint";
import { PRACTICE_NAME } from "@/lib/report/branding";
import { logAudit } from "@/lib/audit";
import { unitSuffix } from "@/lib/screening/units";

export async function generateMetadata() {
  const t = await getTranslations("screening");
  return { title: t("report"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

/**
 * De kop van een blad.
 *
 * Overgenomen uit de bestaande performancerapporten: een bovenregel die zegt
 * van wie en van welke praktijk dit blad is, de titel in de smalle snede, een
 * ondertitel die zegt wat er gemeten is, en rechts de behandelaar achter een
 * gouden lijn. Daaronder een gouden regel over de hele breedte.
 *
 * Staat op ELK blad en niet alleen op de kaft, want de bladen raken los. Dat
 * is dezelfde reden als de herhalende kopregel bij het printen, maar dan
 * zichtbaar en op zijn plek in plaats van in de marge.
 */
function PageHead({
  eyebrow,
  title,
  subtitle,
  tester,
  role,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  tester?: string | null;
  role: string;
}) {
  return (
    <header className="mb-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.12em] text-ink-muted uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold uppercase">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {tester && (
          <div className="shrink-0 border-r-2 border-brand-600 pr-3 text-right">
            <p className="font-display text-base font-semibold">{tester}</p>
            <p className="font-mono text-[10px] tracking-[0.12em] text-brand-700 uppercase">
              {role}
            </p>
          </div>
        )}
      </div>
      <div className="mt-2.5 h-px bg-brand-600" />
    </header>
  );
}

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
  return <p className="report-foot font-mono tracking-[0.08em]">{label}</p>;
}

/**
 * Het screeningrapport om af te drukken of als PDF te bewaren.
 *
 * Rendert UITSLUITEND uit een bevroren versie, nooit uit de huidige stand. Dat
 * is bij een screening scherper dan bij een intake: de praktijk kan op
 * /praktijk/library een drempel bijstellen, en zonder deze regel zou een afdruk
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
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="font-mono text-[10px] tracking-[0.12em] text-ink-muted uppercase">
                  {PRACTICE_NAME} · {s.occurredOn}
                </p>
                <h1 className="mt-1 font-display text-4xl font-bold uppercase">
                  {s.athleteName ?? t("title")}
                </h1>
                <p className="mt-1 text-sm text-ink-muted">
                  {[
                    t("title"),
                    s.bodyMassKg ? `${s.bodyMassKg} kg` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {s.testerName && (
                <div className="shrink-0 border-r-2 border-brand-600 pr-3 text-right">
                  <p className="font-display text-lg font-semibold">{s.testerName}</p>
                  <p className="font-mono text-[10px] tracking-[0.12em] text-brand-700 uppercase">
                    {t("tester")}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-2.5 h-px bg-brand-600" />
            <p className="mt-1.5 font-mono text-[10px] text-ink-muted">
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
                    className="break-inside-avoid border border-hairline bg-canvas px-3.5 py-3"
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
                            {unitSuffix(r.unit)}
                          </p>
                        ))}
                    </div>
                    {g.bands && (
                      <BandStrip bands={g.bands} markers={g.markers} className="mt-2 w-full" />
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
            <section className="mb-6 flex gap-4 break-inside-avoid bg-ink px-4 py-3.5 print:[print-color-adjust:exact]">
              <h2 className="shrink-0 pt-0.5 font-mono text-[10px] tracking-[0.12em] text-brand-200 uppercase">
                {t("decision")}
              </h2>
              <p className="text-sm leading-relaxed text-[var(--color-night-ink)]">{s.notes}</p>
            </section>
          )}

          {[
            { key: "strength" as const, heading: tn("strengths"), rows: strengths },
            { key: "development" as const, heading: tn("developments"), rows: developments },
          ].map(({ key, heading, rows }) =>
            rows.length === 0 ? null : (
              <section key={key} className="mb-6 break-inside-avoid">
                {/* Een gekleurde bovenlijn per kolom, zoals in de bestaande
                    rapporten: groen voor wat goed gaat, goud voor wat werk
                    vraagt. De lijn draagt de kleur en niet de tekst, zodat het
                    kopje zelf op volle inkt leesbaar blijft. */}
                <div
                  className={`h-0.5 ${key === "strength" ? "bg-ok" : "bg-brand-600"}`}
                />
                <h2 className="mt-1.5 mb-1 font-mono text-[10px] tracking-[0.12em] uppercase">
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
            <PageHead
              eyebrow={`${PRACTICE_NAME} \u00b7 ${s.athleteName ?? ""}`}
              title={t(`blocks.${block}` as "blocks.core")}
              subtitle={s.occurredOn}
              tester={s.testerName}
              role={t("tester")}
            />

            {/* Een tabel en geen lijst. Links en rechts horen twee kolommen te
                zijn die je verticaal kunt aflezen: zo staan alle linkerwaarden
                van een blok onder elkaar en zie je een patroon per zijde, niet
                alleen per test. Zo staat het ook in de rapporten die de
                praktijk nu zelf maakt. */}
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-hairline text-left font-mono text-[10px] tracking-[0.1em] text-ink-muted uppercase">
                  <th className="py-1.5 font-medium">{t("test")}</th>
                  <th className="py-1.5 pl-3 text-right font-medium">{t("left")}</th>
                  <th className="py-1.5 pl-3 text-right font-medium">{t("right")}</th>
                  <th className="py-1.5 pl-3 text-right font-medium">{t("asymmetry")}</th>
                  <th className="w-[200px] py-1.5 pl-3" />
                </tr>
              </thead>
              <tbody>
                {groupByMetric(rows).map((g) => {
                  const cell = (side: string) => {
                    const row = g.sides.find((r) => r.side === side);
                    if (!row) return null;
                    const prev = prevOf(g, side);
                    return (
                      <>
                        <span className={`font-mono tabular-nums ${figureInk(row.bandScore)}`}>
                          {row.status === "computed" && row.value !== null
                            ? `${row.value.toFixed(row.decimals)}${unitSuffix(row.unit)}`
                            : t(`unavailable.${row.unavailableReason ?? "missing_input"}` as "unavailable.missing_input")}
                        </span>
                        {(row.bandStatus || typeof prev === "number") && (
                          <span className="mt-0.5 block text-[10px] text-ink-muted">
                            {[
                              row.bandStatus?.replace(/_/g, " "),
                              typeof prev === "number"
                                ? t("was", { value: prev.toFixed(row.decimals) })
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" \u00b7 ")}
                          </span>
                        )}
                      </>
                    );
                  };
                  const bilateral = g.sides.length === 1 && g.sides[0].side === "bilateral";
                  const dir = g.asymmetry ? asymDirection(g.asymmetry) : null;
                  return (
                    <tr key={g.metricKey} className="border-b border-rule break-inside-avoid">
                      <td className="py-1.5 pr-3 align-top">{g.name}</td>
                      {bilateral ? (
                        <td className="py-1.5 pl-3 text-right align-top" colSpan={2}>
                          {cell("bilateral")}
                        </td>
                      ) : (
                        <>
                          <td className="py-1.5 pl-3 text-right align-top">{cell("left")}</td>
                          <td className="py-1.5 pl-3 text-right align-top">{cell("right")}</td>
                        </>
                      )}
                      {/* Geen kleur op de asymmetrie. Wanneer een verschil te
                          groot is, is een klinische drempel, en die hoort in
                          reference_rules en niet in een renderer. Een grens
                          die hier hard ingetypt staat is precies wat de
                          bibliotheek moet voorkomen. */}
                      <td className="py-1.5 pl-3 text-right align-top font-mono tabular-nums">
                        {g.asymmetry?.status === "computed" && g.asymmetry.value !== null ? (
                          <>
                            {g.asymmetry.value.toFixed(1)}&#8201;%
                            {dir && (
                              <span className="ml-1 text-ink-muted">
                                {sideMark(dir === "lowerLeft" ? "left" : "right")}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-muted">&#8211;</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-3 align-middle">
                        {g.bands && (
                          <BandStrip bands={g.bands} markers={g.markers} className="w-full" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* De losse vlaggen bij dit blok, zodat een opmerking naast zijn
                meting staat en niet drie bladen verderop. Sterktes en
                ontwikkelpunten staan al op de kaft. */}
            {observations.filter((n) => n.kind === null && n.metricKey && rows.some((r) => r.metricKey === n.metricKey)).map((note) => (
              <p key={note.id} className="mt-2 text-xs">
                <span className="font-semibold text-brand-700">{noteLabel(note)}.</span>{" "}
                {note.body}
                {note.action && ` \u2192 ${note.action}`}
              </p>
            ))}

            {foot(block)}
          </section>
        ))}

        <section className="report-page">
          <PageHead
            eyebrow={`${PRACTICE_NAME} \u00b7 ${s.athleteName ?? ""}`}
            title={t("legend")}
            subtitle={s.occurredOn}
            tester={s.testerName}
            role={t("tester")}
          />

          {/* De sleutel bij de strips. Een figuur zonder legende in een
              medisch rapport dwingt de lezer te raden wat een open stip
              betekent, en dat is precies wat een leeswijzer moet voorkomen. */}
          {s.results.some((r) => r.bands) && (
            <p className="mb-4 max-w-prose text-xs text-ink-muted">{t("figureKey")}</p>
          )}

          {s.unclassified > 0 && (
            <p className="mb-4 max-w-prose text-xs text-ink-faint">
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
