"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { postJson } from "@/lib/postJson";

/**
 * Een test uitfaseren, of een uitgefaseerde terugzetten.
 *
 * Uitfaseren vraagt eerst om bevestiging, in de knop zelf en niet in een
 * venster: wat er gebeurt staat ernaast, en terugzetten kan altijd.
 */
export function RetireTest({ testKey, mode }: { testKey: string; mode: "retire" | "restore" }) {
  const t = useTranslations("library");
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const result = await postJson("/api/coach/tests", { action: mode, testKey });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("changeFailed"));
      return;
    }
    if (mode === "retire") router.push("/praktijk/library");
    else router.refresh();
  }

  const quiet =
    "inline-flex min-h-11 items-center rounded px-3 text-sm ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas active:scale-[0.98] disabled:opacity-40";

  if (mode === "restore") {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" onClick={run} disabled={busy} className={quiet}>
          {t("restoreTest")}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} className={`${quiet} text-danger`}>
          {t("retireTest")}
        </button>
      ) : (
        <div className="rounded border border-danger/30 bg-danger-soft p-3">
          <p className="text-sm">{t("retireConfirm")}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="inline-flex min-h-11 items-center rounded bg-danger px-4 text-sm text-white active:scale-[0.98] disabled:opacity-40"
            >
              {t("retireYes")}
            </button>
            <button type="button" onClick={() => setAsking(false)} className={quiet}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
