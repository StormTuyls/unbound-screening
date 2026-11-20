-- Fase 5a, stap 2: de intake schrijft via intake_server in plaats van PostgREST.
--
-- Wat hier tot nu toe als service_role liep: aanmelden (profiel en atleetrij
-- aanmaken), toestemming vastleggen, het profiel bewaren, een intake starten,
-- hervatten en indienen, en het gesprek. Per kolom, en alleen wat die paden
-- schrijven.
--
-- Bewust NIET: de rol van een profiel bijwerken. Bij aanmelden wordt een
-- bestaand profiel bijgewerkt zonder de rol aan te raken (zie
-- ensureAthleteForUser), dus de serverrol hoeft niemand te kunnen promoveren.
-- Ook geen delete: weggooien en verwijderen lopen via medical.discard_intake en
-- medical.purge_athlete, die hun eigen rechten hebben.

-- Aanmelden en profiel.
grant select (archived_at, created_at) on public.profiles to intake_server;
grant insert (id, role, full_name, locale) on public.profiles to intake_server;
grant update (full_name) on public.profiles to intake_server;

grant insert (profile_id, full_name, email, locale, retention_mode, retention_until)
  on public.athletes to intake_server;
grant update (
  full_name, date_of_birth, phone, sport, discipline, club, federation, coach_name,
  street, postal_code, city, country, practitioner_id,
  retention_mode, retention_until, retention_basis
) on public.athletes to intake_server;

-- Toestemming: vastleggen, nooit wijzigen. Intrekken is een aparte handeling.
grant insert (athlete_id, intake_id, consent_version, purposes, ip, user_agent, locale)
  on public.consents to intake_server;

-- Een intake starten, hervatten en indienen.
grant insert (athlete_id, locale, access_token_hash, consent_granted_at)
  on public.intakes to intake_server;
grant update (access_token_hash, status, submitted_at) on public.intakes to intake_server;

-- Het gesprek.
grant select, insert (intake_id, role, content, about_field_key)
  on public.chat_messages to intake_server;
