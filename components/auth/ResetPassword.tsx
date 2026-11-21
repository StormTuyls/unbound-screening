"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthShell } from "@/components/auth/AuthShell";

/**
 * Een wachtwoord kiezen via een eenmalige link: wachtwoord vergeten, of een
 * uitnodiging.
 *
 * De token staat in het fragment (#token=...), niet in de query. Een browser
 * stuurt het fragment nooit naar de server, dus het belandt niet in de logs
 * van de app of van de proxy ervoor, en niet in een Referer. Pas bij het
 * opslaan gaat hij in de body naar /api/auth/reset, dat hem meteen opgebruikt.
 *
 * Geen huidig wachtwoord, in tegenstelling tot het wijzigscherm op het profiel.
 * Wie hier komt is per definitie iemand die het niet meer weet; de mail is het
 * bewijs.
 *
 * Daarna naar de voordeur en niet naar een vast scherm: die stuurt een atleet
 * naar zijn thuisscherm en een behandelaar naar de werklijst.
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function ResetPassword() {
  const t = useTranslations("password");
  const router = useRouter();
  // null op de server en tijdens het hydrateren: dan toont het scherm het
  // formulier en niet meteen "deze link werkt niet meer".
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => null);
  const token = hash === null ? null : new URLSearchParams(hash.slice(1)).get("token");
  const signedIn = hash === null || Boolean(token);

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longEnough = next.length >= 8;
  const matches = next === confirm;
  const canSubmit = longEnough && matches && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as { next?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error === "expired" ? t("resetExpired") : t("changeFailed"));
      }

      router.replace(payload.next ?? "/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("changeFailed"));
      setBusy(false);
    }
  }

  const field =
    "mt-1.5 w-full rounded-md border border-hairline bg-surface px-3.5 py-2.5 text-base outline-none focus-visible:border-brand-600";

  return (
    <AuthShell intro={signedIn ? t("resetIntro") : t("resetExpired")}>
      <h2 className="text-lg font-semibold tracking-tight">{t("resetTitle")}</h2>

      {!signedIn ? (
        <>
          {/* Een verlopen of al gebruikte link levert geen sessie op. Dan is
              een wachtwoordveld tonen wreed: je typt iets in en het werkt
              niet, zonder te zeggen waarom. */}
          <p className="mt-1 text-sm text-ink-muted">{t("resetExpired")}</p>
          <Link
            href="/auth/forgot"
            className="mt-5 flex min-h-11 w-full items-center justify-center rounded-md bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800"
          >
            {t("requestNew")}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-muted">{t("resetIntro")}</p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) void submit();
            }}
            className="mt-6"
          >
            <label className="block">
              <span className="text-label uppercase text-ink-faint">{t("new")}</span>
              <input
                value={next}
                onChange={(event) => setNext(event.target.value)}
                type="password"
                minLength={8}
                autoComplete="new-password"
                autoFocus
                className={field}
              />
            </label>

            <label className="mt-4 block">
              <span className="text-label uppercase text-ink-faint">{t("confirm")}</span>
              <input
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                type="password"
                minLength={8}
                autoComplete="new-password"
                className={field}
              />
            </label>

            {next.length > 0 && !longEnough && (
              <p className="mt-2 text-xs text-danger">{t("tooShort")}</p>
            )}
            {confirm.length > 0 && !matches && (
              <p className="mt-2 text-xs text-danger">{t("mismatch")}</p>
            )}
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 min-h-11 w-full rounded-md bg-brand-700 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-800 disabled:opacity-40"
            >
              {busy ? t("resetSaving") : t("resetSave")}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
