-- Fase 5a, stap 4: team en uitnodigingen via intake_server in plaats van PostgREST.
--
-- Het recht dat stap 2 bewust niet gaf, komt hier wel: de rol van een profiel
-- wijzigen. Een beheerder promoveert of degradeert collega's op /praktijk/team,
-- en zonder dit recht kan dat niet. De app-laag laat het alleen toe voor een
-- admin (de routes onder app/api/coach/practitioners controleren de rol) en
-- blockedTeamChange houdt de laatste beheerder tegen. Gearchiveerd zetten volgt dezelfde weg.
--
-- Uitnodigen en een behandelaar aanmaken schrijven het profiel en de atleetrij
-- in één transactie. Mislukt de tweede, dan rolt de eerste vanzelf terug: geen
-- delete-recht op profiles nodig.
--
-- Accounts zelf (auth.users) blijven bij Supabase Auth tot fase 5c.

grant insert (practitioner_kind) on public.profiles to intake_server;
grant update (role, practitioner_kind, archived_at) on public.profiles to intake_server;

grant insert (practitioner_id) on public.athletes to intake_server;
