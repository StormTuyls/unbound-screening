# Beveiliging

Wie mag wat, en wat houdt iemand tegen die dat niet mag. Sinds fase 5 draait de app zonder Supabase:
één Postgres, een documentenmap op schijf, en eigen aanmeldingen.

## De poort is de app

De browser praat alleen met de app. Er is geen PostgREST meer en geen Supabase Auth, dus geen tweede
weg naar de databank. Elke pagina en elke route beslist zelf wie er binnen mag:

| Wie | Functie | Waar |
|---|---|---|
| Behandelaar | `checkCoach()`, `requireCoach()` | `lib/review/access.ts` |
| Atleet | `currentAthlete()` | `lib/intake/athlete.ts` |
| Atleet, binnen een intake | `requireIntake()`, `requireEditableIntake()` | `lib/intake/session.ts` |
| Beheerder | rolcontrole in de routes | `app/api/coach/practitioners/` |
| Cron | `Authorization: Bearer $CRON_SECRET` | `app/api/cron/retention/route.ts` |

Een nieuwe route zonder een van deze aanroepen is open. Er is geen proxy die dat opvangt, en die is er
ook nooit geweest: `proxy.ts` verlengde alleen de sessie en is weg.

## De databank

De app verbindt als `intake_server`. Die rol mag per tabel en vaak per kolom alleen wat de app doet;
de migraties `20261120*` en `20261121*` leggen elke grant met een reden vast. Opvallend:

- Geen `delete` op medische tabellen. Weggooien en verwijderen lopen via `medical.discard_intake` en
  `medical.purge_athlete`, met hun eigen rechten.
- `medical.field_proposals` is append-only; alleen de purge mag erin wissen.
- Wel: de rol van een profiel wijzigen. Een beheerder promoveert collega's op `/praktijk/team`. De app
  laat dat alleen een beheerder doen en houdt de laatste beheerder tegen.

**RLS staat aan, zonder policies.** Tot fase 5 deden policies een tweede controle voor wie via
PostgREST in de browser rechtstreeks tabellen las. Die weg bestaat niet meer, en `intake_server` omzeilt
RLS (BYPASSRLS). De policies zijn dus weg (`20261121100000_app_is_the_gate.sql`), maar RLS blijft aan:
een rol die er ooit per ongeluk bij komt zonder BYPASSRLS, ziet een lege databank in plaats van alles.

Wat de tweede laag vroeger deed, doet nu dit:

- de controles in de app, hierboven;
- de smalle rechten van `intake_server`;
- het audit-log: triggers op elke medische tabel, plus `logAudit` voor wie las en wie exporteerde;
- de databank hangt niet aan het internet. Op de eigen server hoort Postgres alleen op het interne
  netwerk van Docker te luisteren; dat is een opdracht voor fase 6, nog geen feit.

## Aanmelden

`lib/auth/`. Geen bibliotheek, wel standaardbouwstenen:

- **Wachtwoorden**: `scrypt` uit Node (N = 2^15), met de parameters in de hash. Bestaande bcrypt-hashes
  uit Supabase werken nog en worden bij de eerste aanmelding vervangen. Minstens 8 tekens.
- **Sessies**: een willekeurig token in een `httpOnly`-cookie; de databank kent alleen de sha256
  ervan. Dertig dagen, verlengd zolang iemand de app gebruikt. Uitloggen haalt de rij weg.
- **Raden afremmen**: na 10 mislukte pogingen in 15 minuten voor hetzelfde adres weigert aanmelden.
  Een onbekend adres kost even lang en krijgt dezelfde melding als een fout wachtwoord.
- **Eenmalige links** (wachtwoord vergeten, uitnodiging): alleen de hash bewaard, één uur
  respectievelijk zeven dagen, en verzilveren is één statement, dus nooit twee keer. De token staat in
  het fragment (`#token=`), dat een browser nooit naar de server stuurt: hij komt niet in de logs van
  de app of van Caddy.
- **Wachtwoord wijzigen of herstellen** logt elke andere browser uit.
- **Verwijderen**: een purge haalt het account weg, met zijn sessies en links (cascade).

## Op de eigen server

Dit regelde Supabase en is nu van wie de server beheert:

- **Versleuteling in rust.** De documentenmap en de databank op een versleutelde schijf (LUKS of
  gelijkwaardig). Dit zijn artikel 9-gegevens.
- **Backups.** `pg_dump` en de documentenmap, samen: het ene zonder het andere is een half dossier.
  Versleuteld en buiten de server bewaard.
- **Mail.** `SMTP_URL` naar een echte mailserver. Zonder werkt "wachtwoord vergeten" niet.
- **Headers.** Staan nog in `vercel.json` (CSP, HSTS, X-Frame-Options, Permissions-Policy) en moeten
  naar `next.config.ts` of Caddy voordat de app achter iets anders dan Vercel draait.
- **Patchen.** Postgres, Node, het besturingssysteem en `npm audit`.
