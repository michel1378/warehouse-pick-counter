create table public.availability_products (
  id uuid primary key default gen_random_uuid(),
  name text not null, sizes jsonb not null default '[]',
  active boolean not null default true, revision integer not null default 1,
  updated_at timestamptz not null default now(),
  photo text not null default '', photos jsonb not null default '[]', photo_count integer not null default 0,
  stock_details jsonb not null default '{"colors":[],"stretch":"","material":"","composition":""}',
  stock_chart text, stock_has_chart boolean not null default false,
  stock_models jsonb not null default '[]', stock_model_count integer not null default 0
);
alter table public.availability_products enable row level security;
revoke all on public.availability_products from public, anon, authenticated;
grant select, insert, update, delete on public.availability_products to service_role;
insert into public.availability_products (id, name, sizes, active, revision, updated_at, photo, photos, photo_count, stock_details, stock_chart, stock_has_chart, stock_models, stock_model_count)
select id, name, sizes, active, revision, updated_at, photo, photos, photo_count, stock_details, stock_chart, stock_has_chart, stock_models, stock_model_count from public.size_products where show_in_availability;
notify pgrst, 'reload schema';
