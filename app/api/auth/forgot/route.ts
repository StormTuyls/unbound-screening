import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { handleError } from "@/lib/http";
import { findAccountByEmail, issueToken } from "@/lib/auth/accounts";
import { appUrl, sendMail } from "@/lib/auth/mail";
import { translator } from "@/lib/i18n/translator";
import { LOCALE_COOKIE, toLocale } from "@/lib/i18n/locale";

/**
 * Wachtwoord vergeten: een link van een uur, per mail.
 *
 * Altijd hetzelfde antwoord, of het adres nu bestaat of niet: anders is dit een
 * manier om af te tasten wie er een account heeft.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email : "";

    const account = email ? await findAccountByEmail(email) : null;
    if (account) {
      const token = await issueToken(account.id, "reset", 1);
      // In het fragment, niet in de query: zie components/auth/ResetPassword.tsx.
      const link = `${appUrl(request)}/auth/reset#token=${encodeURIComponent(token)}`;
      const t = translator(toLocale((await cookies()).get(LOCALE_COOKIE)?.value), "mail");
      await sendMail({
        to: email.trim(),
        subject: t("resetSubject"),
        text: t("resetBody", { link }),
      }).catch((error) => console.error("[auth] resetmail mislukt", error));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
