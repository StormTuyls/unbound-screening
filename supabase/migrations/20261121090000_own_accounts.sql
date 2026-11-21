-- Fase 5c: eigen accounts, sessies en eenmalige links, in plaats van Supabase Auth.
--
-- Wat Supabase Auth bijhield, staat nu in vier tabellen die alleen de server
-- (intake_server) raakt:
--
--   accounts        e-mail en wachtwoordhash. Zelfde id als vroeger in
--                   auth.users, zodat profielen, atleten en het audit-spoor
--                   naar dezelfde mensen blijven wijzen.
--   sessions        één rij per ingelogde browser. Het cookie draagt een
--                   willekeurig token; hier staat alleen de sha256 ervan.
--   account_tokens  eenmalige links: wachtwoord vergeten en uitnodigingen.
--                   Ook alleen als hash, met een vervaldatum en used_at.
--   login_failures  mislukte aanmeldingen per e-mailadres, om raden af te
--                   remmen. Supabase deed dat met zijn eigen rate limit.
--
-- Bestaande wachtwoorden blijven werken: auth.users bewaarde bcrypt-hashes, en
-- die gaan ongewijzigd mee. Bij de eerste geslaagde aanmelding herhasht de app
-- ze met scrypt (lib/auth/password.ts).
--
-- Het kopiëren en het omhangen van de foreign key gebeuren alleen als
-- auth.users bestaat, dus op een Supabase-databank. Op de eigen server is er
-- niets om te kopiëren; daar komt de data via een dump.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text,
  created_at timestamptz not null default now(),
  constraint accounts_email_shape check (email = lower(email) and email like '%_@_%')
);
create unique index accounts_email_unique on public.accounts (email);

comment on column public.accounts.password_hash is
  'scrypt$N$r$p$salt$hash, of een bcrypt-hash uit Supabase ($2a$...) tot de eerste aanmelding. Null: uitgenodigd, nog geen wachtwoord gekozen.';

create table public.sessions (
  token_hash text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_account_idx on public.sessions (account_id);

create table public.account_tokens (
  token_hash text primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  purpose text not null check (purpose in ('reset', 'invite')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index account_tokens_account_idx on public.account_tokens (account_id);

create table public.login_failures (
  email text not null,
  at timestamptz not null default now()
);
create index login_failures_email_at_idx on public.login_failures (email, at);

-- Niemand behalve de server. RLS aan zonder policies: een rol zonder BYPASSRLS
-- ziet hier dus niets, ook niet als iemand ooit per ongeluk een grant toevoegt.
alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
alter table public.account_tokens enable row level security;
alter table public.login_failures enable row level security;

grant select, insert, delete on public.accounts to intake_server;
grant update (email, password_hash) on public.accounts to intake_server;
grant select, insert, delete on public.sessions to intake_server;
grant update (expires_at) on public.sessions to intake_server;
grant select, insert, delete on public.account_tokens to intake_server;
grant update (used_at) on public.account_tokens to intake_server;
grant select, insert, delete on public.login_failures to intake_server;

-- Bestaande accounts meenemen en profiles naar de nieuwe tabel laten wijzen.
do $$
begin
  if to_regclass('auth.users') is null then
    return;
  end if;

  insert into public.accounts (id, email, password_hash, created_at)
  select id, lower(email), nullif(encrypted_password, ''), created_at
    from auth.users
   where email is not null
  on conflict (id) do nothing;

  alter table public.profiles drop constraint if exists profiles_id_fkey;
end
$$;

alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references public.accounts (id) on delete cascade;
