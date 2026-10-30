# unbound-screening

Screening en performancediagnostiek. Deelt de databank met `athlete-intake`, deelt geen code.

Deze repo is nog leeg. Dat is met opzet: de code mag er pas in als de opschoonronde af is, want
wat in de eerste commit zit blijft in de geschiedenis staan.

## Wat hier komt

30 bestanden uit `athlete-intake`, plus 15 gedeelde bestanden die gekopieerd worden in plaats van
gedeeld. De volledige inventaris staat in `docs/splitsing.md` van die repo, met per bestand het
aantal regels en waarom het mee moet.

Acht migraties verhuizen mee, van `20261009090000` tot en met `20261011100000`. De databank blijft
dezelfde: eigendom per tabel, met een `baseline.sql` voor lokaal ontwikkelen. Zie `screening-app.md`
§2b in `athlete-intake`.

## Wat er eerst af moet

1. De afkapwaarden uit `lib/screening/library.ts` naar een seed die niet in git staat. Het gaat om
   17 bandenarrays en 72 drempelwaarden, afkomstig uit de Screening 2025-bestanden van de praktijk.
2. De Supabase-projectverwijzing uit `vercel.json` naar een env-variabele.
3. Een beslissing over een eigen databankrol, `screening_server` of dezelfde `intake_server`.

## Privé, voorlopig

`overdracht.md` zegt dat deze repo publiek wordt. Die afspraak is van vóór de change request over de
testbibliotheek, waarin de benchmarks en de interne asymmetriegrenzen van de praktijk staan.

Zet hem pas publiek als punt 1 tot 3 af zijn en als de praktijk weet dat haar protocol en haar
benchmarks naar buiten gaan. Een repo die eenmaal publiek is geweest, is gekopieerd.
