import { createServerSupabase } from "@/lib/supabase/server";
import { appDb } from "@/lib/supabase/service";

/**
 * Wie de atleet is die inlogt.
 *
 * Overgenomen uit athlete-intake, maar kleiner: daar hoort ook het aanmelden,
 * het zetten van de rol en de toestemmingspoort bij. Aanmelden blijft aan die
 * kant, want daar begint een dossier. Hier is alleen de vraag of de bezoeker
 * een atleet is, zodat hij zijn eigen metingen mag zien.
 *
 * Een atleet is niet een ROL maar een RIJ: public.athletes.profile_id wijst
 * naar het profiel dat inlogt. Dat onderscheid is niet academisch. Een
 * behandelaar die zelf bij deze praktijk in behandeling is, is allebei: staf in
 * zijn rol, atleet in zijn dossier. Zou dit op profiles.role kijken, dan zou
 * die persoon zijn eigen metingen niet kunnen openen.
 *
 * Via de service-rol en met een filter op profile_id, net als in de intake: de
 * atleet mag zijn eigen rij lezen maar niet aanmaken, en het filter doet hier
 * het werk dat RLS anders zou doen.
 */
export interface AthleteIdentity {
  /** auth.users.id, tevens profiles.id. */
  userId: string;
  /** public.athletes.id. De medische kant hangt hieraan, niet aan de user. */
  athleteId: string;
  fullName: string | null;
  email: string | null;
}

export async function currentAthlete(): Promise<AthleteIdentity | null> {
  const supabase = await createServerSupabase();

  // getUser() en niet getSession(): de eerste laat de authserver het token
  // valideren, de tweede leest wat er in de cookie staat. Voor een beslissing
  // over een medisch dossier is dat verschil het hele punt.
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return null;

  const { data: athlete } = await appDb()
    .from("athletes")
    .select("id, full_name, email, deleted_at")
    .eq("profile_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!athlete) return null;

  return {
    userId: auth.user.id,
    athleteId: athlete.id as string,
    fullName: (athlete.full_name as string | null) ?? null,
    email: (athlete.email as string | null) ?? auth.user.email ?? null,
  };
}
