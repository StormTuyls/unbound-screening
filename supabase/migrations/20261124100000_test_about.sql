-- Wat een test is en hoe hij uitgevoerd wordt, in gewone taal.
--
-- De bibliotheek wist tot nu toe alleen hoe een test heet, wat hij meet en waar
-- de drempels liggen. Een tester die de test niet dagelijks doet, of een
-- behandelaar die een rapport leest, moest de rest elders opzoeken. Deze tekst
-- staat naast de testnaam als uitleg bij aanwijzen of tikken.
--
-- Op de test en niet op het protocol: het protocol legt de meetafspraak vast en
-- is onveranderlijk, deze tekst is uitleg en mag bijgeschaafd worden zonder een
-- nieuwe protocolversie. Null betekent: nog geen uitleg, en dan toont de UI
-- alleen wat de data al weet.
alter table public.test_definitions
  add column about_nl text,
  add column about_en text;

comment on column public.test_definitions.about_nl is
  'Uitleg bij de test voor tester en lezer: wat hij meet en hoe hij uitgevoerd '
  'wordt. Geen drempels; die staan in reference_rules.';
comment on column public.test_definitions.about_en is
  'Engelse versie van about_nl.';
