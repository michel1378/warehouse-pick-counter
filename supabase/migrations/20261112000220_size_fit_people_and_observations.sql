begin;
create table if not exists public.size_fit_people (
  id uuid primary key default gen_random_uuid(),
  slot smallint not null unique check (slot between 1 and 3),
  label text not null check (char_length(label) between 1 and 40),
  height numeric check (height between 100 and 230),
  weight numeric check (weight between 25 and 250),
  shoulders numeric check (shoulders between 20 and 90),
  chest_circumference numeric check (chest_circumference between 45 and 200),
  waist_circumference numeric check (waist_circumference between 40 and 200),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  check ((height is null) = (weight is null))
);
alter table public.size_fit_people enable row level security;
revoke all on public.size_fit_people from public, anon, authenticated;
grant select, update on public.size_fit_people to service_role;
insert into public.size_fit_people (slot, label)
select n, 'Человек ' || n from generate_series(1,3) n
on conflict (slot) do nothing;
comment on table public.size_fit_people is 'Three shared fitting profiles. Body circumferences, not garment widths. Admin session routes only.';
alter table public.size_products add column if not exists fittings jsonb not null default '[]'::jsonb;
alter table public.size_products add constraint size_products_fittings_array_check
  check (jsonb_typeof(fittings) = 'array' and jsonb_array_length(fittings) <= 200);
comment on column public.size_products.fittings is 'Observed try-ons with immutable body snapshot per observation; only session-checked size API writes.';
commit;
