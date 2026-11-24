import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkCoach } from "@/lib/review/access";
import { ChangePassword } from "@/components/auth/ChangePassword";

export async function generateMetadata() {
  const t = await getTranslations("coach");
  return { title: t("account"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Het eigen account van een behandelaar.
 *
 * Atleten wijzigen hun wachtwoord op /profile; een behandelaar had geen plek
 * en kon alleen via de herstelmail, die een werkende SMTP vraagt.
 */
export default async function AccountPage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/praktijk/login?next=/praktijk/account");
  if (access.kind !== "coach") notFound();

  const t = await getTranslations("coach");
  const { email, fullName } = access.coach;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">{t("account")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {fullName ? `${fullName} · ${email}` : email}
      </p>
      <ChangePassword email={email} />
    </div>
  );
}
