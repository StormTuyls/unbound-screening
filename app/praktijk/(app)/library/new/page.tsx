import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkCoach } from "@/lib/review/access";
import { NewTestForm } from "@/components/coach/NewTestForm";

export async function generateMetadata() {
  const t = await getTranslations("library");
  return { title: t("newTitle"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/** Een test toevoegen aan de screening. Zie lib/db/testLibrary.ts. */
export default async function NewTestPage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/praktijk/login?next=/praktijk/library/new");
  if (access.kind !== "coach") notFound();

  const t = await getTranslations("library");

  return (
    <>
      <Link href="/praktijk/library" className="inline-flex min-h-11 items-center text-xs text-ink-muted underline">
        {t("title")}
      </Link>
      <header className="mt-1 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("newIntro")}</p>
      </header>
      <NewTestForm />
    </>
  );
}
