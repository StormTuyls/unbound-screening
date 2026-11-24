-- Tests toevoegen en uitfaseren vanuit de app, bij de referentiewaarden.
--
-- Een nieuwe test is drie rijen: de test, protocol v1 en één gemeten metriek,
-- dezelfde vorm als simple() in lib/screening/libraryShape.ts. Alleen insert op
-- precies die kolommen; een bestaande test of metriek bewerken kan de app niet,
-- want daar hangen metingen aan.
--
-- Verwijderen is uitfaseren: retired_at zetten of weer leegmaken. Een echte
-- delete zou metingen, rapporten en regels van hun test losmaken.
grant insert (key, block, sort_order, label_nl, label_en, laterality, domain,
              about_nl, about_en)
  on public.test_definitions to intake_server;
grant update (retired_at) on public.test_definitions to intake_server;

grant insert (test_key, version, label_nl, label_en, device, trial_count,
              trial_selection, protocol_confirmed, protocol_source)
  on public.test_protocols to intake_server;

grant insert (key, test_key, kind, label_nl, label_en, unit, direction, is_core,
              decimals)
  on public.metric_definitions to intake_server;
