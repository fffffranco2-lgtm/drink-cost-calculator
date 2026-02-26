create table if not exists public.order_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.orders
  add column if not exists session_id uuid references public.order_sessions(id) on delete set null;

create index if not exists order_sessions_opened_at_idx
  on public.order_sessions(opened_at desc);

create index if not exists orders_session_status_created_at_idx
  on public.orders(session_id, status, created_at desc);
