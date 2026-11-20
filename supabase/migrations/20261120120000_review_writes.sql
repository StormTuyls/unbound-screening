-- Fase 5a, stap 3: goedkeuren via intake_server in plaats van PostgREST.
--
-- Goedkeuren zet status, approved_at en approved_by in één statement; de
-- check-constraint intakes_approval_complete eist dat alle drie samen kloppen.
-- status mocht al (stap 2, indienen). Lezen van de goedkeurder en de naam van de
-- atleet valt onder de rechten van stap 1 en 2.

grant update (approved_at, approved_by) on public.intakes to intake_server;
