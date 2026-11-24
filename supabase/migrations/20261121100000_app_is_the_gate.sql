-- Fase 5d: de app is de enige poort. RLS-policies en auth.uid() eruit.
--
-- Tot fase 5 had dit ontwerp twee lagen: de app controleerde wie er mocht, en
-- RLS deed het nog eens voor wie via PostgREST in de browser rechtstreeks
-- tabellen las. "Wie één van de twee vergeet, wordt door de ander
-- tegengehouden."
--
-- Na fase 5 bestaat die tweede weg niet meer. Er is geen PostgREST en geen
-- Supabase Auth: de browser praat alleen met de app, en de app verbindt als
-- intake_server, een rol die RLS sowieso omzeilt (BYPASSRLS). De policies
-- beschermden dus niets meer, en ze leunden op auth.uid(), een functie die op
-- een gewone Postgres niet bestaat.
--
-- Wat er tegenover staat, en wat dus de bescherming is:
--   - Elke route en pagina controleert zelf: requireCoach(), currentAthlete(),
--     requireEditableIntake(). Zie docs/beveiliging.md.
--   - intake_server krijgt per tabel en per kolom alleen wat de app doet, geen
--     delete op medische tabellen buiten de purgefuncties.
--   - Het audit-log, met triggers op elke medische tabel.
--   - De databank hangt niet aan het internet.
--
-- RLS blijft AAN, zonder policies. Voor elke rol zonder BYPASSRLS betekent dat:
-- niets zien. Een rol die er ooit per ongeluk bij komt, ziet dus een lege
-- databank in plaats van alles.
--
-- auth.uid() wordt private.actor_id(): de instelling app.actor_id, of null.
-- Voor de verbinding van de app was auth.uid() altijd al null (er reist geen
-- Supabase-token mee), dus de triggers loggen nu precies wat ze al logden:
-- actor 'system', en de app schrijft er met logAudit bij wie het was. Zet de app
-- ooit `set local app.actor_id` in een transactie, dan kennen ook de triggers de
-- actor.

create or replace function private.actor_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.actor_id', true), '')::uuid
$$;

drop policy if exists athletes_select on public.athletes;
drop policy if exists athletes_write on public.athletes;
drop policy if exists audit_log_select on public.audit_log;
drop policy if exists chat_messages_select on public.chat_messages;
drop policy if exists consents_select on public.consents;
drop policy if exists field_definitions_select on public.field_definitions;
drop policy if exists intakes_select on public.intakes;
drop policy if exists intakes_write on public.intakes;
drop policy if exists metric_definitions_select on public.metric_definitions;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists reference_rules_select on public.reference_rules;
drop policy if exists test_definitions_select on public.test_definitions;
drop policy if exists test_protocols_select on public.test_protocols;

-- De enige tabel die RLS nooit aan kreeg (20260915090000_field_scope.sql). Geen
-- gat, want medical hing nooit aan PostgREST, maar de regel hierboven geldt voor
-- alles.
alter table medical.field_skips enable row level security;

drop function if exists private.is_staff();
drop function if exists private.current_role();

CREATE OR REPLACE FUNCTION private.actor_kind()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (select p.role::text from public.profiles p where p.id = (select private.actor_id())),
    'system'
  );
$function$

;

CREATE OR REPLACE FUNCTION private.audit_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entity_id text;
  v_detail jsonb;
  v_old jsonb;
  v_new jsonb;
begin
  -- Zie de toelichting bij deze migratie: tijdens een purge schrijft
  -- medical.purge_athlete één regel met de tellingen in plaats van honderden.
  if current_setting('app.purge_in_progress', true) = 'on' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_entity_id := coalesce(v_old ->> 'id', v_old ->> 'intake_id');
    v_detail := jsonb_build_object('op', 'delete');
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_entity_id := coalesce(v_new ->> 'id', v_new ->> 'intake_id');
    v_detail := jsonb_build_object(
      'op', 'update',
      'changed', (
        select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
        from jsonb_object_keys(v_new) k
        where v_new -> k is distinct from v_old -> k
      )
    );
  else
    v_new := to_jsonb(new);
    v_entity_id := coalesce(v_new ->> 'id', v_new ->> 'intake_id');
    v_detail := jsonb_build_object('op', 'insert');
  end if;

  insert into public.audit_log (
    actor_id, actor_kind, action, entity_schema, entity_table, entity_id, detail
  )
  values (
    (select private.actor_id()),
    private.actor_kind(),
    lower(tg_op),
    tg_table_schema,
    tg_table_name,
    v_entity_id,
    v_detail
  );

  return null;
end;
$function$

;

CREATE OR REPLACE FUNCTION private.log_access(p_entity_table text, p_entity_id text, p_action text DEFAULT 'read'::text, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.audit_log (
    actor_id, actor_kind, action, entity_schema, entity_table, entity_id, detail
  )
  values (
    (select private.actor_id()),
    private.actor_kind(),
    p_action,
    'medical',
    p_entity_table,
    p_entity_id,
    p_detail
  );
end;
$function$

;

