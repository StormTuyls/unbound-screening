"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { postJson } from "@/lib/postJson";
import { matchBand, type Band } from "@/lib/screening/bands";
import { zoneFill } from "@/components/report/BandStrip";

/**
 * Invoerscherm voor een screening.
 *
 * Twee keuzes die het gedrag bepalen:
 *
 * 1. Een leeg veld is NIET nul. Het wordt null, en dat betekent "hoorde bij deze
 *    sessie, niet gemeten". Spec §12.1 eist dat onderscheid, en een
 *    number-input die bij leegmaken 0 doorgeeft zou het meteen weggooien.
 *
 * 2. Niets is verplicht. Een behandelaar die alleen de enkel bekijkt hoort geen
 *    volledige screening te hoeven invullen; FR-03 noemt dat micro-entry. De
 *    server weigert alleen een sessie waarin helemaal niets staat.
 *
 * De band staat naast het veld terwijl je typt. Pas na het bewaren weten waar
 * een waarde op uitkomt is te laat: dan staat de tester al met zijn tablet in
 * de gang en is de atleet weg. Dezelfde matchBand als de server, dus wat hier
 * staat is wat in het rapport komt, op de meetdatum na (zie de pagina).
 */

export interface EntryTest {
  testKey: string;
  block: string;
  label: string;
  metricKey: string;
  unit: string;
  perSide: boolean;
  decimals: number;
  /** De banden als deze test nu kan indelen, anders null. */
  bands: Band[] | null;
  protocolConfirmed: boolean;
  note: string | null;
}

/** Alleen de volgorde; de namen komen uit de berichtencatalogus. */
const BLOCK_ORDER = [
  "anthropometry", "mobility_ll", "mobility_ul", "core",
  "movement_ll", "forcedecks", "strength_ul",
];

const UNIT_LABELS: Record<string, string> = {
  deg: "°",
  cm: "cm",
  n: "N",
  xbw: "×BW",
  score: "0–3",
};

type Values = Record<string, string>;
type Side = "left" | "right" | "bilateral";

const sidesOf = (test: EntryTest): Side[] =>
  test.perSide ? ["left", "right"] : ["bilateral"];
const keyOf = (test: EntryTest, side: Side) => `${test.metricKey}|${side}`;

/** Leeg blijft leeg. Alleen een echt getal wordt een getal. */
function toValue(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ScreeningEntry({
  athleteId,
  tests,
}: {
  athleteId: string;
  tests: EntryTest[];
}) {
  const router = useRouter();
  const t = useTranslations("screening");
  const [values, setValues] = useState<Values>({});
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [bodyMass, setBodyMass] = useState("");
  const [notes, setNotes] = useState("");
  // Een sleutel per geopend formulier, en dus niet per poging: een tweede tik
  // of een herhaling na een trage verbinding draagt dezelfde sleutel en levert
  // dezelfde sessie op in plaats van een tweede.
  const [clientToken] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocks = useMemo(() => {
    const grouped = new Map<string, EntryTest[]>();
    for (const test of tests) {
      const list = grouped.get(test.block) ?? [];
      list.push(test);
      grouped.set(test.block, list);
    }
    // In de volgorde van BLOCK_LABELS en niet die van de query. De databank
    // sorteert op bloknaam, en alfabetisch komt 'forcedecks' dan tussen 'core'
    // en 'mobility_ll' te staan. Een screening loopt van meten naar bewegen naar
    // kracht; dat is de volgorde waarin een behandelaar hem ook afwerkt.
    return [...grouped].sort(
      (a, b) =>
        (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [tests]);

  const isFilled = (key: string) => (values[key] ?? "").trim() !== "";
  /** Ingevulde en beschikbare velden, per zijde geteld zoals ze op het scherm staan. */
  const tally = (items: EntryTest[]) => {
    const keys = items.flatMap((test) => sidesOf(test).map((side) => keyOf(test, side)));
    return { filled: keys.filter(isFilled).length, total: keys.length };
  };
  const all = tally(tests);
  const filled = all.filled;

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const entries = tests.flatMap((test) =>
      sidesOf(test)
        .map((side) => ({
          metricKey: test.metricKey,
          side,
          value: toValue(values[keyOf(test, side)]),
        }))
        // Alleen wat de tester aanraakte gaat mee. Een sessie waarin elke test
        // van de bibliotheek als "niet gemeten" staat is onleesbaar: 26 lege
        // rijen zeggen minder dan de drie die hij wel deed.
        .filter((entry) => entry.value !== null),
    );

    const result = await postJson("/api/coach/screening", {
      athleteId,
      clientToken,
      occurredOn,
      bodyMassKg: toValue(bodyMass),
      notes: notes.trim() === "" ? null : notes.trim(),
      entries,
    });

    if (!result.ok) {
      setError(result.error ?? t("saveFailed"));
      setSaving(false);
      return;
    }

    // saving blijft hier bewust staan: de navigatie volgt, en een knop die
    // tussendoor weer aanklikbaar wordt levert een tweede sessie op.
    const { sessionId } = result.data as { sessionId: string };
    router.push(`/praktijk/screening/${sessionId}`);
  }

  return (
    // Een echt formulier, zodat Enter bewaart. Het <fieldset> is er voor de
    // andere helft daarvan: zolang het bewaren loopt staat alles op slot, en
    // dat is één attribuut in plaats van een disabled per veld.
    <form onSubmit={save}>
      <fieldset disabled={saving} className="space-y-8">
        <section className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">{t("date")}</span>
            <input
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className="min-h-[52px] w-full rounded border border-hairline bg-surface px-3 text-base"
            />
          </label>
          <label className="text-sm">
            {/* Spec §8: relatieve kracht gebruikt de massa van DIE dag. Hij wordt
                op de sessie gekopieerd, niet uit het profiel gelezen. */}
            <span className="mb-1 block text-xs text-ink-muted">{t("bodyMass")}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={bodyMass}
              onChange={(e) => setBodyMass(e.target.value)}
              className="min-h-[52px] w-full rounded border border-hairline bg-surface px-3 text-base"
            />
          </label>
          <label className="text-sm sm:col-span-1">
            <span className="mb-1 block text-xs text-ink-muted">{t("context")}</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("contextHint")}
              className="min-h-[52px] w-full rounded border border-hairline bg-surface px-3 text-base"
            />
          </label>
        </section>

        {/* Waar je bent en hoeveel er in elk blok staat, met één tik erheen.
            Zevenenvijftig velden onder elkaar zonder houvast was de klacht. */}
        <nav aria-label={t("blocksNav")} className="flex flex-wrap gap-1.5 border-b border-hairline pb-4">
          {blocks.map(([block, items]) => {
            const count = tally(items);
            return (
              <a
                key={block}
                href={`#blok-${block}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
              >
                {t(`blocks.${block}` as "blocks.core")}
                <span className="text-label text-ink-muted tabular-nums">
                  {count.filled}/{count.total}
                </span>
              </a>
            );
          })}
        </nav>

        {blocks.map(([block, items]) => {
          const count = tally(items);
          return (
            <section key={block} id={`blok-${block}`} className="scroll-mt-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold">{t(`blocks.${block}` as "blocks.core")}</h2>
                <p className="text-xs text-ink-muted tabular-nums">
                  {t("fieldsFilled", { filled: count.filled, total: count.total })}
                </p>
              </div>
              <ul className="divide-y divide-hairline border-t border-hairline">
                {items.map((test) => (
                  <li
                    key={test.metricKey}
                    className="grid gap-x-4 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_13rem] sm:items-center"
                  >
                    <div className="min-w-0">
                      <span className="block text-base">{test.label}</span>
                      <span className="text-xs text-ink-muted">
                        {test.unit === "hand_lengths"
                          ? t("handLengths")
                          : (UNIT_LABELS[test.unit] ?? test.unit)}
                        {/* Eerlijk zijn over wat dit getal straks oplevert. Een
                            tester die weet dat een test niet scoort, weet ook
                            waarom er later geen band staat. */}
                        {test.bands === null && ` · ${t("noBandYet")}`}
                        {!test.protocolConfirmed && ` · ${t("protocolNotFixed")}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {sidesOf(test).map((side) => {
                        const key = keyOf(test, side);
                        // Groot genoeg voor een duim, en 17px zodat iOS niet
                        // inzoomt bij focus.
                        const field =
                          "min-h-[52px] w-[92px] rounded border border-hairline bg-surface px-2.5 text-right text-[17px] tabular-nums";
                        const set = (raw: string) => setValues((v) => ({ ...v, [key]: raw }));
                        return (
                          <label key={side} className="flex items-center gap-1.5">
                            <span
                              className={
                                test.perSide ? "w-3 text-xs text-ink-muted uppercase" : "sr-only"
                              }
                            >
                              {side === "bilateral" ? test.label : t(side).slice(0, 1)}
                            </span>
                            {test.unit === "score" ? (
                              <select
                                aria-label={side === "bilateral" ? undefined : `${test.label}, ${t(side)}`}
                                value={values[key] ?? ""}
                                onChange={(e) => set(e.target.value)}
                                className={field}
                              >
                                <option value="">-</option>
                                {[0, 1, 2, 3].map((n) => (
                                  <option key={n} value={n}>
                                    {n}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                aria-label={side === "bilateral" ? undefined : `${test.label}, ${t(side)}`}
                                type="number"
                                inputMode="decimal"
                                step={test.decimals === 0 ? "1" : "0.1"}
                                value={values[key] ?? ""}
                                onChange={(e) => set(e.target.value)}
                                className={field}
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>

                    {/* Wat de waarde oplevert. Het bandwoord staat er voluit
                        bij: de kleur alleen is in grijswaarden niets. */}
                    <div aria-live="polite" className="flex flex-wrap items-center gap-1.5">
                      {test.bands !== null &&
                        sidesOf(test).map((side) => {
                          const value = toValue(values[keyOf(test, side)]);
                          if (value === null || test.bands === null) return null;
                          const band = matchBand(value, test.bands);
                          const max = Math.max(0, ...test.bands.map((b) => b.score ?? 0));
                          return (
                            <span
                              key={side}
                              style={{
                                background: band
                                  ? zoneFill(band.score ?? null, max)
                                  : "var(--color-canvas)",
                              }}
                              className="rounded-chip px-2 py-0.5 text-label uppercase ring-1 ring-hairline ring-inset"
                            >
                              {side !== "bilateral" && `${t(side).slice(0, 1)} `}
                              {band ? band.status.replace(/_/g, " ") : t("outsideBands")}
                            </span>
                          );
                        })}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {error && <p className="text-sm text-danger">{error}</p>}

        {/* De onderrand van een iPad is de thuisbalk. Zonder de inset valt
            de bewaarknop daar deels achter. */}
        <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-hairline bg-canvas pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="min-w-0">
            <p className="text-base font-semibold tabular-nums">
              {filled === 0 ? t("nothingEntered") : t("fieldsFilled", all)}
            </p>
            <p className="hidden text-xs text-ink-muted sm:block">{t("onlyTouched")}</p>
          </div>
          <button
            type="submit"
            disabled={saving || filled === 0}
            className="inline-flex min-h-[52px] shrink-0 items-center rounded bg-brand-700 px-5 text-base font-semibold text-white disabled:opacity-40"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
