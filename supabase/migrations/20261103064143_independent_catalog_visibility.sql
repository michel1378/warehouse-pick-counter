-- One-time distribution. Re-running preserves every explicit visibility choice.
begin;
alter table public.size_products add column if not exists show_in_availability boolean;
alter table public.size_products add column if not exists show_in_sizes boolean;
update public.size_products
set show_in_availability = true
where show_in_availability is null;
update public.size_products
set show_in_sizes = jsonb_array_length(examples) > 0
where show_in_sizes is null;
alter table public.size_products alter column show_in_availability set default true;
alter table public.size_products alter column show_in_availability set not null;
alter table public.size_products alter column show_in_sizes set default false;
alter table public.size_products alter column show_in_sizes set not null;
-- Keep direct browser access closed; mutations go through admin-checked routes.
alter table public.size_products enable row level security;
revoke all on table public.size_products from anon, authenticated;
commit;
