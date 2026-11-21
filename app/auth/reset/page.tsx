import { getTranslations } from "next-intl/server";
import { ResetPassword } from "@/components/auth/ResetPassword";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return {
    title: t("password"),
    robots: { index: false, follow: false },
  };
}

/**
 * Een wachtwoord kiezen, na de link uit de herstelmail of de uitnodiging.
 *
 * De token zit in het fragment en komt dus nooit hier aan; het scherm leest hem
 * in de browser en /api/auth/reset beslist of hij nog geldig is.
 */
export default function ResetPage() {
  return <ResetPassword />;
}
