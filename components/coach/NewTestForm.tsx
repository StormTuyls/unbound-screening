"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { postJson } from "@/lib/postJson";
import { TEST_BLOCKS } from "@/lib/screening/blocks";
import { UNITS, unitLabel } from "@/lib/screening/units";

const DIRECTIONS = ["higher_better", "lower_better", "target_range", "neutral"] as const;

/**
 * Een nieuwe test: wat er nodig is om hem te kunnen meten. Banden komen daarna,
 * op de pagina van de test, want een test zonder regel wordt al gemeten en
 * getrend.
 */
export function NewTestForm() {
  const t = useTranslations("library");
  const ts = useTranslations("screening");
  const ti = useTranslations("testInfo");
  const router = useRouter();

  const [labelNl, setLabelNl] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [block, setBlock] = useState<(typeof TEST_BLOCKS)[number]>(TEST_BLOCKS[0]);
  const [laterality, setLaterality] = useState<"per_side" | "bilateral">("per_side");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("deg");
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>("higher_better");
  const [decimals, setDecimals] = useState("1");
  const [device, setDevice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [aboutNl, setAboutNl] = useState("");
  const [aboutEn, setAboutEn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = labelNl.trim() !== "" && labelEn.trim() !== "" && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    const result = await postJson("/api/coach/tests", {
      action: "create",
      labelNl,
      labelEn,
      block,
      laterality,
      unit,
      direction,
      decimals: Number(decimals),
      device,
      protocolConfirmed: confirmed,
      aboutNl,
      aboutEn,
    });
    if (!result.ok) {
      setError(result.error ?? t("changeFailed"));
      setSaving(false);
      return;
    }
    const { metricKey } = result.data as { metricKey: string };
    router.push(`/praktijk/library/${encodeURIComponent(metricKey)}`);
  }

  const field = "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base";
  const caption = "mb-1 block text-xs text-ink-muted";

  return (
    <form
      className="max-w-2xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={caption}>{t("newNameNl")}</span>
          <input value={labelNl} onChange={(e) => setLabelNl(e.target.value)} required maxLength={120} className={field} />
        </label>
        <label className="block text-sm">
          <span className={caption}>{t("newNameEn")}</span>
          <input value={labelEn} onChange={(e) => setLabelEn(e.target.value)} required maxLength={120} className={field} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className={caption}>{t("newBlock")}</span>
          <select value={block} onChange={(e) => setBlock(e.target.value as typeof block)} className={field}>
            {TEST_BLOCKS.map((b) => (
              <option key={b} value={b}>{ts(`blocks.${b}` as "blocks.core")}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={caption}>{t("newLaterality")}</span>
          <select value={laterality} onChange={(e) => setLaterality(e.target.value as typeof laterality)} className={field}>
            <option value="per_side">{ti("laterality.per_side")}</option>
            <option value="bilateral">{ti("laterality.bilateral")}</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className={caption}>{t("newDevice")}</span>
          <input value={device} onChange={(e) => setDevice(e.target.value)} maxLength={80} placeholder={t("newDeviceHint")} className={field} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className={caption}>{t("newUnit")}</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className={field}>
            {UNITS.map((u) => (
              <option key={u} value={u}>{unitLabel(u, ts("handLengths"))}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={caption}>{t("newDirection")}</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} className={field}>
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>{ti(`direction.${d}`)}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className={caption}>{t("newDecimals")}</span>
          <select value={decimals} onChange={(e) => setDecimals(e.target.value)} className={field}>
            {["0", "1", "2", "3", "4"].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex min-h-11 items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
        <span>
          {t("newConfirmed")}
          <span className="mt-0.5 block text-xs text-ink-faint">{t("newConfirmedHint")}</span>
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className={caption}>{t("aboutTitle")} · {t("aboutNl")}</span>
          <textarea value={aboutNl} onChange={(e) => setAboutNl(e.target.value)} rows={3} maxLength={2000} className={field} />
        </label>
        <label className="block text-sm">
          <span className={caption}>{t("aboutTitle")} · {t("aboutEn")}</span>
          <textarea value={aboutEn} onChange={(e) => setAboutEn(e.target.value)} rows={3} maxLength={2000} className={field} />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={!canSave}
        className="inline-flex min-h-11 items-center rounded bg-brand-700 px-4 text-sm text-white transition-colors hover:bg-brand-800 active:scale-[0.98] disabled:opacity-40"
      >
        {saving ? t("saving") : t("newSave")}
      </button>
    </form>
  );
}
