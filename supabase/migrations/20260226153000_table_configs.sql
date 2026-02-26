create extension if not exists pgcrypto;

create table if not exists public.table_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint table_configs_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$')
);

create index if not exists table_configs_name_idx
  on public.table_configs(name);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists table_configs_set_updated_at on public.table_configs;
create trigger table_configs_set_updated_at
before update on public.table_configs
for each row
execute function public.set_updated_at();
