"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { postJson } from "@/lib/postJson";
import type { ScreeningNote } from "@/lib/db/screeningNotes";

/**
 * Opmerkingen en vlaggen bij een screening. FR-13.
 *
 * Spec §14 is waarom dit geen alarmregel is: "The system should not create an
 * alarm for every red cell." Wat opvolging vraagt bepaalt de behandelaar. Een
 * vlag blijft open tot iemand hem sluit, en sluiten is eenrichtingsverkeer:
 * een gesloten vlag die weer open kan is geen spoor maar een schakelaar.
 */

const SEVERITY_STYLE: Record<string, string> = {
  info: "bg-canvas text-ink-muted",
  watch: "bg-warn-soft text-warn",
  action: "bg-danger-soft text-danger",
};

export function ScreeningNotes({
  sessionId,
  notes,
  metrics,
}: {
  sessionId: string;
  notes: ScreeningNote[];
  /** Waar een opmerking over kan gaan, met hun leesbare naam. */
  metrics: Array<{ key: string; label: string }>;
}) {
  const t = useTranslations("notes");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [metricKey, setMetricKey] = useState("");
  const [severity, setSeverity] = useState<"info" | "watch" | "action">("watch");
  // Leeg is een gewone vlag. Pas wie hier kiest zet de opmerking op pagina 1
  // van het rapport, en dan pas heeft een nummer zin.
  const [kind, setKind] = useState<"" | "strength" | "development">("");
  const [rank, setRank] = useState("");
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(payload: unknown) {
    setBusy(true);
    setError(null);
    const result = await postJson(`/api/coach/screening/${sessionId}/notes`, payload);
    if (!result.ok) {
      setError(result.error ?? t("saveFailed"));
      setBusy(false);
      return false;
    }
    router.refresh();
    setBusy(false);
    return true;
  }

  async function save() {
    const ok = await post({
      action: "add",
      metricKey: metricKey === "" ? null : metricKey,
      severity,
      kind: kind === "" ? null : kind,
      rank: kind === "" || rank.trim() === "" ? null : Number(rank),
      body: body.trim(),
      note: action.trim() === "" ? null : action.trim(),
      target: target.trim() === "" ? null : target.trim(),
    });
    if (ok) {
      setBody("");
      setAction("");
      setTarget("");
      setMetricKey("");
      setSeverity("watch");
      setKind("");
      setRank("");
      setOpen(false);
    }
  }

  const label = (key: string | null) =>
    key === null ? t("wholeSession") : (metrics.find((m) => m.key === key)?.label ?? key);

  return (
    <section className="mb-8 border-t border-hairline pt-4">
      <div className="mb-1 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">{t("heading")}</h2>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex min-h-11 items-center text-xs text-brand-700 underline"
          >
            {t("add")}
          </button>
        )}
      </div>
      <p className="mb-2 max-w-prose text-xs text-ink-faint">{t("intro")}</p>

      {/* Buiten het toevoegpaneel, want hij stond erin.
          Een mislukte sluiting zette de melding wel maar toonde hem nooit: het
          paneel is dan dicht. Bij een handeling die een vlag sluit is dat de
          slechtste plek om stil te falen. role="alert" erbij, want een regel
          die ergens op het scherm verschijnt bereikt een schermlezer niet. */}
      {error && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {error}
        </p>
      )}

      {notes.length === 0 && !open && (
        <p className="text-sm text-ink-faint">{t("none")}</p>
      )}

      {notes.length > 0 && (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {notes.map((note) => (
            <li key={note.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                {/* Kleur is niet het enige signaal: de ernst staat er als woord. */}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${SEVERITY_STYLE[note.severity]}`}
                >
                  {t(note.severity as "watch")}
                </span>
                <span className="text-xs text-ink-muted">{label(note.metricKey)}</span>
                {/* Wat op pagina 1 van het rapport komt, is hier te zien. Zonder
                    dit merk je pas bij het afdrukken welke opmerking op de kaft
                    staat. */}
                {note.kind && (
                  <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted">
                    {t(note.kind === "strength" ? "strength" : "development")}
                    {note.rank !== null && ` ${note.rank}`}
                  </span>
                )}
                {note.state === "resolved" && (
                  <span className="text-xs text-ink-faint">· {t("resolved")}</span>
                )}
              </div>

              <p className={`mt-1 text-sm ${note.state === "resolved" ? "text-ink-muted" : ""}`}>
                {note.body}
              </p>
              {note.action && (
                <p className="mt-0.5 text-xs text-ink-muted">→ {note.action}</p>
              )}
              {note.target && (
                <p className="mt-0.5 text-xs text-ink-muted">
                  {t("target")}: {note.target}
                </p>
              )}

              <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs text-ink-faint">
                <span>
                  {note.createdAt.slice(0, 10)}
                  {note.authorName ? ` · ${t("by")} ${note.authorName}` : ""}
                </span>
                {note.state === "open" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => post({ action: "resolve", noteId: note.id })}
                    className="inline-flex min-h-11 items-center underline disabled:opacity-40"
                  >
                    {t("resolve")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 space-y-3 rounded border border-hairline p-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-muted">{t("body")}</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-ink-muted">{t("aboutMetric")}</span>
              <select
                value={metricKey}
                onChange={(e) => setMetricKey(e.target.value)}
                className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
              >
                <option value="">{t("wholeSession")}</option>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-xs text-ink-muted">{t("severity")}</span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as "info" | "watch" | "action")}
                className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
              >
                <option value="info">{t("info")}</option>
                <option value="watch">{t("watch")}</option>
                <option value="action">{t("action")}</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-ink-muted">{t("kind")}</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "" | "strength" | "development")}
                className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
              >
                <option value="">{t("kindNone")}</option>
                <option value="strength">{t("strength")}</option>
                <option value="development">{t("development")}</option>
              </select>
            </label>

            {/* Alleen zichtbaar als er een soort gekozen is: een nummer zonder
                soort weigert de databank, en een leeg veld dat niets mag
                bevatten is een val. */}
            {kind !== "" && (
              <label className="text-sm">
                <span className="mb-1 block text-xs text-ink-muted">{t("rank")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="99"
                  value={rank}
                  onChange={(e) => setRank(e.target.value)}
                  className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
                />
                <span className="mt-1 block text-xs text-ink-faint">{t("rankHint")}</span>
              </label>
            )}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-muted">{t("action_field")}</span>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder={t("actionHint")}
              className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-muted">{t("target")}</span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={t("targetHint")}
              className="w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || body.trim() === ""}
              className="inline-flex min-h-11 items-center rounded bg-brand-700 px-3 text-sm text-white disabled:opacity-40"
            >
              {busy ? t("adding") : t("add")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center rounded border border-hairline px-3 text-sm"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
