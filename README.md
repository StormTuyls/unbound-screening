# unbound-screening

Screening en performancediagnostiek. Deelt de databank met `athlete-intake`, deelt geen code.

Gekopieerd uit `athlete-intake` en niet gedeeld, omdat de intake wordt overgedragen aan de klant en
de screening niet. De prijs daarvan staat vast en hoort geaccepteerd te worden: een fix in
`lib/db/sql.ts` moet twee keer gebeuren. Zie `docs/screening-app.md` in die repo.

## Opzetten

```bash
cp lib/screening/afkapwaarden.voorbeeld.ts lib/screening/afkapwaarden.ts
npm install
npm run typecheck
npm test
```

De echte afkapwaarden staan niet in git. Zonder dat kopieertje bouwt de app niet, en dat is met
opzet: wat in de eerste commit zit, staat er voorgoed in.

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
2. **De Supabase-projectverwijzing.** Stond in `vercel.json` van de intake, in de CSP. Hier is nog
   geen deployconfiguratie; zet de projecturl als env-variabele zodra die er komt.
3. **De praktijk moet het weten.** Het protocol en de benchmarks komen uit haar eigen bestanden. Dat
   is geen formaliteit.

## Databank

Dezelfde Supabase als de intake. Eigendom per tabel: alles onder `medical.screening_*` en de
bibliotheektabellen in `public` horen hier, de intaketabellen daar, en `athletes`, `profiles` en
`audit_log` zijn gedeeld.

De acht migraties in `supabase/migrations/` zijn hier gekopieerd en staan nog steeds ook in
`athlete-intake`. Dat moet nog uit elkaar, samen met een `baseline.sql` voor lokaal ontwikkelen.
Zie §2b van `screening-app.md`.

**Nog niet beslist:** een eigen databankrol `screening_server`, of dezelfde `intake_server` als de
intake. Zie §2 van hetzelfde document.

## Wat hier niet in zit

De intake: het dossier, de chat, de documenten, het rapport van de intake. `lib/db/athletes.ts` is
hier een uitgeklede kopie die alleen de identiteit en de populatievelden ophaalt, zonder de intakes
en zonder het dossier.
