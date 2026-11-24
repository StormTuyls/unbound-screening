# unbound-screening

Eén app voor een sportpraktijk. Atleten leveren hun voorgeschiedenis aan (een gesprek met een
assistent, documenten die worden uitgelezen, en een behandelaar die alles nakijkt) en lezen hun
metingen. Behandelaars voeren screenings in en krijgen rapporten tegen referentiewaarden.

Draait op één Postgres en een documentenmap op schijf. Geen Supabase meer in de app: eigen
aanmeldingen (`lib/auth/`), eigen opslag (`lib/documents/`), en SQL via `lib/db/sql.ts`. De
voormalige intake-app (`athlete-intake`) is een bevroren overdrachtskopie en draait niet meer.
Hoe de beveiliging in elkaar zit: `docs/beveiliging.md`.

## Opzetten

```bash
cp lib/screening/afkapwaarden.voorbeeld.ts lib/screening/afkapwaarden.ts
cp .env.example .env.local        # en invullen
npm install
npx supabase start                # lokaal alleen nog als Postgres
npm run db:reset                  # migraties, rol intake_server, bibliotheek
npm run seed:dev                  # zes atleten en een behandelaar
npm run dev -- --port 3100
```

Inloggen als behandelaar: `coach@unbound.test` / `screening-dev`. Een behandelaar of beheerder
aanmaken: `npx tsx scripts/create-coach.ts e-mail "Naam" physio|coach [--admin]`.

De echte afkapwaarden staan niet in git. Zonder dat kopieertje bouwt de app niet, en dat is met
opzet: wat in de eerste commit zit, staat er voorgoed in.

### In een container

```bash
npm run docker:up                 # app op :3200, Mailpit op :8025
```

Mail die de app verstuurt (herstellinks, uitnodigingen) komt lokaal in Mailpit terecht:
http://localhost:8025.

### Testen

```bash
npm run typecheck && npm run lint && npm test
npm run test:purge && npm run test:discard && npm run test:screening   # tegen de lokale databank
```

`test:purge` en `test:discard` zijn het bewijs dat verwijderen per tabel en per bestand niets
achterlaat. Draai ze na elke wijziging aan de databank of de documentenmap.

## De afkapwaarden

`lib/screening/library.ts` is opgeknipt in drie stukken:

| Bestand | Wat erin staat | In git |
|---|---|---|
| `libraryShape.ts` | types, de `simple()`-helper, de bronverwijzing | ja |
| `afkapwaarden.ts` | de testbibliotheek van de praktijk: 26 tests, 21 regels | **nee** |
| `library.ts` | samenstellen en valideren | ja |

`afkapwaarden.voorbeeld.ts` staat er wel in, met drie verzonnen tests. Genoeg om te bouwen en de
validator te draaien, niet genoeg om iets over de praktijk te weten.

`library.ts` exporteert `AFKAPWAARDEN_AANWEZIG`. De bibliotheektest keurt daarmee alleen de echte
data als die er is; de validator zelf wordt altijd getest.

## Voordat deze repo publiek wordt

1. **Vier bandgrenzen zitten nog in testfixtures.** `evals/unit/screening-bands.test.ts` regel 23 tot
   26 en 116 tot 117, en `evals/unit/screening-evaluate.test.ts` regel 23 tot 26. Het zijn de
   grenzen van de passieve SLR, gebruikt als voorbeeld. Vervang ze door neutrale getallen en
   controleer dat beide tests nog slagen.
2. **De praktijk moet het weten.** Het protocol en de benchmarks komen uit haar eigen bestanden. Dat
   is geen formaliteit.

## Databank

Alle migraties staan in `supabase/migrations/`; `npm run db:reset` bouwt de databank vanaf nul. De
app verbindt als `intake_server`, met per tabel en per kolom alleen wat ze doet. Testen en seeds
gebruiken een eigen admin-verbinding (`scripts/adminDb.ts`, `ADMIN_DATABASE_URL`).

Lokaal levert de Supabase-stack nog de Postgres. De migraties zelf leunen nog op een paar dingen die
alleen daar bestaan (het `auth`-schema in de eerste migraties, de rollen `anon` en `authenticated`).
Voor een gewone Postgres op de eigen server komt er in fase 6 een baseline.

### Een atleet verwijderen

Loopt via `medical.purge_athlete()`, dat de rijen in één transactie wist en per tabel telt. De
screeningtabellen hangen met `athlete_id ... on delete cascade` aan `public.athletes`, dus ook dat
wissen gebeurt in de databank. Daarna ruimt `lib/purge/purge.ts` de documentenmap en het
inlogaccount op, en controleert dat er niets meer staat.

De json die de functie teruggeeft is `PurgeCounts` in `lib/purge/db.ts`. Verandert de vorm, dan
verandert dat type mee: een veld dat verdwijnt zonder dat het type het weet, geeft `undefined` en
geen foutmelding.
