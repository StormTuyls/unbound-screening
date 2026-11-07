import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { currentCoach } from "@/lib/review/access";
import { CoachLogin } from "@/components/coach/CoachLogin";

export async function generateMetadata() {
  const t = await getTranslations("titles");

  return {
    title: t("signIn"),
    robots: { index: false, follow: false },
  };
}

/** Inloggen voor de behandelaar. Zelfde manier als de atleet: e-mail en wachtwoord. */
export default async function CoachLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Al ingelogd: doorlopen naar waar hij heen wilde, anders naar de voordeur.
  // Die kijkt wie er is; dit scherm hoeft dat niet nog eens te beslissen.
  const coach = await currentCoach();
  if (coach) redirect(next && next.startsWith("/") ? next : "/");

  return <CoachLogin next={next ?? null} />;
}
