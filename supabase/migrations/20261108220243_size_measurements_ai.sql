-- Local preparation only. Apply to a reviewed test database before any production rollout.
begin;
alter table public.size_products add column if not exists size_profile jsonb default null
  check (size_profile is null or (jsonb_typeof(size_profile) = 'object'
    and jsonb_typeof(size_profile->'columns') = 'array'
    and jsonb_typeof(size_profile->'rows') = 'array'
    and jsonb_array_length(size_profile->'rows') between 1 and 30));
comment on column public.size_products.size_profile is 'Per-item numeric measurements in cm and garment properties; independent of stock and owner examples.';

-- Schema only. Card data is prepared separately against verified existing IDs
-- and revisions; never seed by name or create products during migration.

-- Counters only: no customer measurements, prompts or provider responses are stored.
create table if not exists public.size_ai_limits (
  subject uuid not null,
  request_day date not null,
  request_count integer not null check (request_count between 1 and 50),
  last_request_at timestamptz not null,
  primary key (subject, request_day)
);
alter table public.size_ai_limits enable row level security;
revoke all on table public.size_ai_limits from public, anon, authenticated;
grant select, insert, update on table public.size_ai_limits to service_role;

create or replace function public.take_size_ai_slot(p_subject uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with slot as (
    insert into public.size_ai_limits as limits (subject, request_day, request_count, last_request_at)
    values (p_subject, (now() at time zone 'UTC')::date, 1, now())
    on conflict (subject, request_day) do update
      set request_count = limits.request_count + 1, last_request_at = now()
      where limits.request_count < 50 and limits.last_request_at <= now() - interval '5 seconds'
    returning 1
  ) select exists (select 1 from slot);
$$;
revoke all on function public.take_size_ai_slot(uuid) from public, anon, authenticated;
grant execute on function public.take_size_ai_slot(uuid) to service_role;
commit;
