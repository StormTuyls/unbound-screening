-- Fase 5a, stap 1: wie er ingelogd is, via intake_server in plaats van PostgREST.
--
-- Tot nu toe las de app de rol van een behandelaar met de sessie van de
-- gebruiker zelf (RLS: profiles_select_self) en de taal en de atleetrij met
-- service_role. Zonder Supabase verdwijnen allebei, dus de serverrol neemt het
-- over. De app-laag filtert op de id van de ingelogde gebruiker; dat is wat
-- RLS hier deed, en intake_server heeft BYPASSRLS.
--
-- Zo smal als het werk vraagt, per kolom:
--   - profiles lezen: rol, naam, taal en soort, voor checkCoach en de
--     taalsynchronisatie. Niet created_at of archived_at: geen van beide
--     paden heeft die nodig.
--   - alleen de taal bijwerken, op de drie plekken waar /api/locale hem zet.
-- Schrijven bij registratie (profielen en atleten aanmaken) volgt in stap 2.

grant select (id, role, full_name, locale, practitioner_kind) on public.profiles to intake_server;
grant update (locale) on public.profiles to intake_server;
grant update (locale) on public.athletes to intake_server;
grant update (locale) on public.intakes to intake_server;
