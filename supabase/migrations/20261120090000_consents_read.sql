-- intake_server mag de toestemmingen lezen.
--
-- Het tabblad Toestemming van het atleetdossier toont wanneer de atleet zijn
-- accounttoestemming gaf (lib/db/athletes.ts, getAthleteProfile). Die query
-- loopt via de directe Postgres-verbinding als intake_server, en die rol had op
-- public.consents geen enkel recht. Lokaal viel dat niet op, omdat de app daar
-- als postgres verbond; met de echte rol gaf elk dossier "permission denied".
--
-- Alleen lezen. Toestemming geven en intrekken loopt nog via service_role
-- (lib/intake/consent.ts) tot fase 5a dat pad verhuist; dat krijgt dan zijn
-- eigen migratie met zijn eigen reden.

grant select on public.consents to intake_server;
