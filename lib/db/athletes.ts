import { appDb } from "@/lib/supabase/service";

/**
 * De atleet, zoals de screening hem nodig heeft.
 *
 * Dit is een uitgeklede kopie van hetzelfde bestand in athlete-intake. Daar
 * haalt het profiel ook de intakes, het dossier en de toestemmingen op, want
 * daar is de atleetpagina het middelpunt van de intake. Hier niet: de screening
 * heeft de naam nodig voor de kop van het scherm, en sekse, sport, discipline,
 * niveau en geboortedatum voor de populatiefilter op de regels. Zie
 * lib/screening/population.ts, waar "onbekend is geen match" de hoofdregel is.
 *
 * De naam komt hier alleen uit de kolom. In de intake valt hij terug op het
 * dossier als de kolom leeg is; die terugval kan hier niet, want het dossier
 * blijft aan de intakekant.
 */
export interface AthleteProfile {
  id: string;
  name: string | null;
  sex: string | null;
  sport: string | null;
  discipline: string | null;
  competitionLevel: string | null;
  dateOfBirth: string | null;
}

export async function getAthleteProfile(
  athleteId: string,
): Promise<AthleteProfile | null> {
  const { data, error } = await appDb()
    .from("athletes")
    .select(
      "id, full_name, sex, sport, discipline, competition_level, date_of_birth",
    )
    .eq("id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  // Lege tekst is hier hetzelfde als niets. Dat is geen schoonheidsfoutje: een
  // lege sport zou in population.ts als waarde meetellen, en dan matcht een
  // regel die op sport filtert op de verkeerde manier.
  const tekst = (waarde: unknown): string | null =>
    typeof waarde === "string" && waarde.trim() !== "" ? waarde : null;

  return {
    id: data.id as string,
    name: tekst(data.full_name),
    sex: tekst(data.sex),
    sport: tekst(data.sport),
    discipline: tekst(data.discipline),
    competitionLevel: tekst(data.competition_level),
    dateOfBirth: tekst(data.date_of_birth),
  };
}
