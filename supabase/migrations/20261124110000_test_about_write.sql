-- De uitleg bij een test wordt in de app bijgehouden, bij de referentiewaarden.
--
-- Alleen deze twee kolommen. De naam, het blok en de lateraliteit van een test
-- blijven van de bibliotheek: daar hangen metingen en regels aan, en die horen
-- niet via een tekstveld te verschuiven. Elke wijziging staat in het audit-log.
grant update (about_nl, about_en) on public.test_definitions to intake_server;
