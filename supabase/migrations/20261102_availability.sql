-- Additive extension of the existing catalog. No product copies, photo rewrites or example changes.
begin;
alter table public.size_products
  add column if not exists stock_details jsonb not null default '{"composition":"","material":"","stretch":"","colors":[]}'::jsonb
    check (jsonb_typeof(stock_details) = 'object'),
  add column if not exists stock_chart text default null
    check (stock_chart is null or char_length(stock_chart) <= 400000),
  add column if not exists stock_has_chart boolean not null default false,
  add column if not exists stock_models jsonb not null default '[]'::jsonb
    check (jsonb_typeof(stock_models) = 'array' and jsonb_array_length(stock_models) <= 6),
  add column if not exists stock_model_count integer not null default 0
    check (stock_model_count between 0 and 6);
-- Keep the existing custom-session API as the only access path.
alter table public.size_products enable row level security;
revoke all on table public.size_products from anon, authenticated;
grant select, insert, update, delete on table public.size_products to service_role;
comment on column public.size_products.stock_details is 'Availability metadata: colors[].sizes null = unspecified; [] = no available sizes. Edited by admin via session-checked API.';
commit;
