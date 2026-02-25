create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_name text,
  customer_phone text,
  notes text,
  status text not null default 'pendente'
    check (status in ('pendente', 'em_progresso', 'concluido')),
  subtotal numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  drink_id text not null,
  drink_name text not null,
  unit_price numeric(12, 2) not null,
  qty integer not null check (qty > 0),
  line_total numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

create index if not exists orders_status_created_at_idx
  on public.orders(status, created_at desc);

create index if not exists order_items_order_id_idx
  on public.order_items(order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();
