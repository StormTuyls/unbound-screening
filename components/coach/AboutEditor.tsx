"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { postJson } from "@/lib/postJson";

/**
 * De uitleg bij een test, zoals hij bij het ⓘ naast de testnaam verschijnt.
 *
 * Twee talen naast elkaar, omdat een lezer in het Engels anders "Nog geen
 * uitleg" ziet. Een leeg veld bewaart null, en dan toont de app weer alleen de
 * feiten.
 */
export function AboutEditor({
  testKey,
  initial,
}: {
  testKey: string;
  initial: { nl: string | null; en: string | null };
}) {
  const t = useTranslations("library");
  const router = useRouter();
  const [nl, setNl] = useState(initial.nl ?? "");
  const [en, setEn] = useState(initial.en ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = nl !== (initial.nl ?? "") || en !== (initial.en ?? "");

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await postJson("/api/coach/reference-rules", {
      action: "about",
      testKey,
      aboutNl: nl,
      aboutEn: en,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? t("changeFailed"));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const field = "w-full rounded border border-hairline bg-surface px-2 py-1.5 text-base";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-ink-muted">{t("aboutNl")}</span>
          <textarea
            value={nl}
            onChange={(e) => {
              setNl(e.target.value);
              setSaved(false);
            }}
            rows={4}
            maxLength={2000}
            className={field}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-ink-muted">{t("aboutEn")}</span>
          <textarea
            value={en}
            onChange={(e) => {
              setEn(e.target.value);
              setSaved(false);
            }}
            rows={4}
            maxLength={2000}
            className={field}
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex min-h-11 items-center rounded bg-brand-700 px-4 text-sm text-white transition-colors hover:bg-brand-800 active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? t("saving") : t("aboutSave")}
        </button>
        {saved && !dirty && (
          <p role="status" className="text-sm text-ok">
            {t("aboutSaved")}
          </p>
        )}
      </div>
    </div>
  );
}
