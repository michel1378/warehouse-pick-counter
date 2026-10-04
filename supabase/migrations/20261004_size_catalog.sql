-- Separate catalog only. Does not modify scans, employees, shifts or payments.
begin;
create table if not exists public.size_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  note text not null default '' check (char_length(note) <= 200),
  sizes jsonb not null check (jsonb_typeof(sizes) = 'array' and jsonb_array_length(sizes) between 1 and 30),
  examples jsonb not null default '[]'::jsonb check (jsonb_typeof(examples) = 'array' and jsonb_array_length(examples) <= 200),
  photo text not null check (char_length(photo) <= 400000),
  active boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.size_products enable row level security;
revoke all on table public.size_products from anon, authenticated;
grant select, insert, update, delete on table public.size_products to service_role;
create index if not exists size_products_active_name_idx on public.size_products (active, name);
comment on table public.size_products is 'Size recommendations: access only via session-checked server routes.';
commit;
