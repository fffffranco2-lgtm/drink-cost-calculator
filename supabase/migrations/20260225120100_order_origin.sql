alter table if exists public.orders
  add column if not exists source text not null default 'balcao'
    check (source in ('mesa_qr', 'balcao')),
  add column if not exists table_code text;

create index if not exists orders_source_table_created_at_idx
  on public.orders(source, table_code, created_at desc);
